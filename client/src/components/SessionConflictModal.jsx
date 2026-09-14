/**
 * client/src/components/SessionConflictModal.jsx
 * Modal dialog prompting user when concurrent device limit (1 desktop + 1 mobile) is reached.
 */
import React from 'react';

export function SessionConflictModal({ deviceType, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white dark:bg-[#1f1f1f] border border-black/10 dark:border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-xl shrink-0">
            ⚠️
          </div>
          <div>
            <h3 className="text-base font-semibold text-[#1a1a1a] dark:text-white">
              Active Session Conflict
            </h3>
            <p className="text-xs text-[#787774] dark:text-[#999]">
              Concurrent session cap: 1 desktop + 1 mobile
            </p>
          </div>
        </div>

        <p className="text-sm text-[#37352f] dark:text-[#ccc] leading-relaxed">
          You are already logged in on <strong>{deviceType}</strong>. Log in here and disconnect that session?
        </p>

        <p className="text-xs text-[#787774] dark:text-[#888] bg-black/5 dark:bg-white/5 p-2.5 rounded-lg border border-black/5 dark:border-white/5">
          ℹ️ <em>Note:</em> This may take a few minutes to take effect on the other device due to token cache windows.
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-medium border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-all text-[#666] dark:text-[#aaa]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all shadow-sm"
          >
            Disconnect &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
}
