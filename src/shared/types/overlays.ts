export type ToastAction = {
  /** Short verb, e.g. 撤销 / Undo. */
  label: string;
  onClick: () => void;
};

export type ToastItem = {
  id: number;
  msg: string;
  /** Optional inline action; runs once, then the toast dismisses with it. */
  action?: ToastAction;
};

export type ConfirmDialogState = {
  show: boolean;
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
};
