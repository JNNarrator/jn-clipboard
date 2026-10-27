export type TiezWebdavQrPayload = {
  v: 1;
  type: "tiez-webdav";
  webdav: {
    url: string;
    username: string;
    password: string;
    basePath: string;
  };
};

export const buildWebdavConfigQrPayload = (input: {
  url: string;
  username: string;
  password: string;
  basePath: string;
}): TiezWebdavQrPayload => ({
  v: 1,
  type: "tiez-webdav",
  webdav: {
    url: input.url.trim(),
    username: input.username.trim(),
    password: input.password,
    basePath: input.basePath.trim() || "tiez-sync",
  },
});

export const isWebdavConfigQrReady = (payload: TiezWebdavQrPayload) =>
  payload.webdav.url.length > 0;
