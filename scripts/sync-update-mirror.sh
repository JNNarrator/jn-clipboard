#!/usr/bin/env bash
# 把 GitHub 最新 release 的桌面端更新产物镜像到 gm 服务器，让 updater
# 摆脱对 GitHub 直连的依赖（本机与 gm 的网络对 github.com:443 时通时断，
# 出口网关会回 "not allowed by ACL" / 504；见 tauri.conf.json 的端点顺序）。
#
# 流程：git ls-remote 拿最新 tag（SSH:443，稳定）→ 走本机系统代理从
# GitHub 下载资产 → 改写 latest.json 的下载 URL 指向
# https://jiangnan.88933.vip/clipboard-update/ → rsync 上传 gm。
#
# 不碰 api.github.com：匿名配额会被共享出口 IP 挤爆（403）。
#
# 用法：./scripts/sync-update-mirror.sh            # 镜像 latest release
#       UPDATE_PROXY=... ./scripts/sync-update-mirror.sh   # 指定代理
#       ./scripts/sync-update-mirror.sh v1.0.8      # 镜像指定 tag
# 每次 release 发布后跑一次。
set -euo pipefail

REPO="JNNarrator/jn-clipboard"
REMOTE_DIR="/home/jiangnan/clipboard-update"
PUBLIC_BASE="https://jiangnan.88933.vip/clipboard-update"

# --- 代理探测：updater 裸连 GitHub 会被出口网关拒，下载必须走代理 -------
if [ -n "${UPDATE_PROXY:-}" ]; then
    PROXY="${UPDATE_PROXY}"
else
    PROXY="$(scutil --proxy | awk '/HTTPSProxy/ {ip=$3} /HTTPSPort/ {port=$3} END {if (ip && port) print "http://" ip ":" port}')"
fi
if [ -z "${PROXY}" ]; then
    echo "未检测到系统代理（scutil --proxy 无 HTTPSProxy），本机直连 GitHub 大概率失败；" >&2
    echo "请开着代理后重试，或 UPDATE_PROXY=http://127.0.0.1:7890 $0" >&2
    exit 1
fi
echo "→ 使用代理: ${PROXY}"

# --retry-all-errors：出口网关/代理的 504、"not allowed by ACL" 是 HTTP
# 状态层错误，默认 --retry 不认，必须让它把这些也算进重试范围。
CURL=(curl -sSfL --retry 8 --retry-delay 3 --retry-all-errors -m 300 -x "${PROXY}")

# --- 最新 tag：git 协议走 SSH:443，不依赖 HTTPS --------------------------
if [ -n "${1:-}" ]; then
    TAG="$1"
else
    TAG="$(git ls-remote --tags "git@github.com:${REPO}.git" \
        | awk -F'refs/tags/' '{print $2}' | grep -v '\^{}$' | sort -V | tail -1)"
fi
[ -n "$TAG" ] || { echo "拿不到最新 tag"; exit 1; }
echo "→ 镜像版本: ${TAG}"
# GitHub 下载地址形如 releases/download/<tag>/<file>，镜像是平铺的：
# 改写时要把 <tag>/ 一起剥掉。
GITHUB_BASE_RE="https://github\\.com/${REPO}/releases/download/${TAG}/"

# --- 资产清单：release 的 expanded_assets 页面（公开 HTML，不走 API）----
ASSET_PAGE="$("${CURL[@]}" "https://github.com/${REPO}/releases/expanded_assets/${TAG}")"
ASSETS="$(grep -oE "/${REPO}/releases/download/${TAG}/[^\"]+" <<<"$ASSET_PAGE" \
    | sed "s|.*releases/download/${TAG}/||" | sort -u)"
[ -n "$ASSETS" ] || { echo "release 页面解析不到资产（tag 是否有发布产物？）"; exit 1; }
echo "→ 资产 $(grep -c . <<<"$ASSETS") 个"

WORK="$(mktemp -d /tmp/clipboard-update.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# latest.json 必须最先到：它声明 updater 真正需要的包名
"${CURL[@]}" -o "$WORK/latest.json" "https://github.com/${REPO}/releases/download/${TAG}/latest.json"

# 必须资产 = updater 会真正下载的包。签名不用单列：latest.json 里内嵌
# platforms.*.signature（.sig 文件只是 release 上的冗余上传）；其余
# （dmg/msi/便携包/.sig）只是人肉下载用的，失败不应阻塞镜像。
MUST="$WORK/.must"
python3 - "$WORK/latest.json" "$MUST" <<'PY'
import json, sys
names = set()
for entry in json.load(open(sys.argv[1])).get("platforms", {}).values():
    names.add(entry["name"])
open(sys.argv[2], "w").write("\n".join(sorted(names)))
PY

fetch_asset() {
    local name="$1"
    if "${CURL[@]}" -o "$WORK/$name" "https://github.com/${REPO}/releases/download/${TAG}/${name}" 2>/dev/null; then
        return 0
    fi
    # 出口网关的 504/ACL 拒绝常持续一小段时间：等一下再补一轮
    echo "    …重试 ${name}" >&2
    sleep 15
    "${CURL[@]}" -o "$WORK/$name" "https://github.com/${REPO}/releases/download/${TAG}/${name}"
}

echo "→ 下载资产（经代理，逐个重试）"
SKIPPED=0
while IFS= read -r name; do
    [ -n "$name" ] || continue
    echo "  · ${name}"
    if fetch_asset "$name"; then
        continue
    fi
    if grep -qxF "$name" "$MUST"; then
        echo "✗ updater 必需资产 ${name} 下载失败，中止镜像（线上保持旧版）" >&2
        exit 1
    fi
    echo "  ⚠ 可选资产 ${name} 本轮跳过（updater 不依赖它）" >&2
    rm -f "$WORK/$name"
    SKIPPED=$((SKIPPED + 1))
done <<<"$ASSETS"

echo "→ 改写 latest.json 的下载地址指向镜像"
python3 - "$WORK/latest.json" "$PUBLIC_BASE" "$GITHUB_BASE_RE" <<'PY'
import json, re, sys
path, public_base, github_re = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(path))
changed = 0
for entry in (data.get("platforms") or {}).values():
    new = re.sub(github_re, public_base + "/", entry["url"])
    changed += new != entry["url"]
    entry["url"] = new
json.dump(data, open(path, "w"), ensure_ascii=False, indent=2)
print(f"  {changed} 个平台的下载地址已指向镜像")
PY

echo "→ rsync 上传 gm:${REMOTE_DIR}"
# 不用 --delete：跳过的可选资产不应把线上已有文件误删，latest.json 才是权威。
# 本机 mktemp 的目录是 700，macOS 的 openrsync 同步属性时会把目标目录也带
# 成 700，nginx（www-data）会吃 403——上传后统一修正权限；顺带清掉
# rsync 会带上去的脚本内部清单文件。
rsync -a --exclude='.must' "$WORK/" "gm:${REMOTE_DIR}/"
ssh gm "chmod 755 ${REMOTE_DIR} && chmod 644 ${REMOTE_DIR}/* 2>/dev/null || true; rm -f ${REMOTE_DIR}/.must"
[ "$SKIPPED" -eq 0 ] || echo "⚠ ${SKIPPED} 个可选资产本轮未镜像，可稍后重跑本脚本补齐"

echo "→ 线上验证"
curl -m 10 -sS -o /dev/null -w "latest.json: HTTP %{http_code}\n" "${PUBLIC_BASE}/latest.json"
python3 - "$PUBLIC_BASE/latest.json" <<'PY'
import json, sys, urllib.request
data = json.load(urllib.request.urlopen(sys.argv[1], timeout=10))
print(f"  版本: {data.get('version')}")
for key, entry in (data.get("platforms") or {}).items():
    assert entry["url"].startswith("https://jiangnan."), f"{key} 的 URL 未改写: {entry['url']}"
    status, _ = urllib.request.urlopen(entry["url"], timeout=15).status, None
    assert status == 200, f"{key} 的包下载返回 {status}"
    print(f"  {key} -> {entry['url'].split('/')[-1]} ✓")
PY
echo "✓ 镜像同步完成：${PUBLIC_BASE}/latest.json（版本 ${TAG}）"
