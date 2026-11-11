import { useState } from "react";
import { Keyboard, MousePointerClick, Search, Tags, X } from "lucide-react";

/**
 * First-launch tour: three cards, skippable at every step, shown once per
 * install (localStorage marker — onboarding is a property of *this device*
 * learning the gestures, not a preference that should ride the sync).
 *
 * What it deliberately does not do: dim the screen, animate arrows toward
 * pixels, or trap focus in a modal. The app is small; a pointed list of the
 * three gestures nobody guesses (paste-into-app, keyboard queue, search
 * filters) in one quiet card beats a theme-park tour.
 */

const STORAGE_KEY = "jn-clipboard.onboarding.done";

export function hasSeenOnboarding(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // storage blocked: show it; being twice-shown beats never
  }
}

const STEPS = [
  {
    icon: MousePointerClick,
    titleKey: "onboarding_click_title",
    bodyKey: "onboarding_click_body",
  },
  {
    icon: Keyboard,
    titleKey: "onboarding_keyboard_title",
    bodyKey: "onboarding_keyboard_body",
  },
  {
    icon: Search,
    titleKey: "onboarding_search_title",
    bodyKey: "onboarding_search_body",
  },
  {
    icon: Tags,
    titleKey: "onboarding_organize_title",
    bodyKey: "onboarding_organize_body",
  },
] as const;

export default function OnboardingCard({ t, onDone }: {
  t: (key: string) => string;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const finish = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* the catch in hasSeenOnboarding covers this */
    }
    onDone();
  };

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="onboarding-card"
      role="dialog"
      aria-modal="false"
      aria-label={t("onboarding_title")}
    >
      <div className="onboarding-head">
        <Icon size={16} className="onboarding-icon" aria-hidden="true" />
        <span className="onboarding-count">{step + 1} / {STEPS.length}</span>
        <button
          type="button"
          className="onboarding-skip"
          onClick={finish}
          aria-label={t("onboarding_skip")}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      <h3 className="onboarding-title">{t(current.titleKey)}</h3>
      <p className="onboarding-body">{t(current.bodyKey)}</p>
      <div className="onboarding-actions">
        {step > 0 && (
          <button type="button" className="onboarding-back" onClick={() => setStep(step - 1)}>
            {t("onboarding_back")}
          </button>
        )}
        <span className="onboarding-spacer" />
        <button type="button" className="onboarding-skip-text" onClick={finish}>
          {t("onboarding_skip")}
        </button>
        <button
          type="button"
          className="settings-action-button"
          onClick={() => (isLast ? finish() : setStep(step + 1))}
        >
          {isLast ? t("onboarding_done") : t("onboarding_next")}
        </button>
      </div>
    </div>
  );
}
