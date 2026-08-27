"use client";

/**
 * Locks the app.
 *
 * A plain submit button in the masthead form. It used to also tell the service worker to purge
 * its page cache, because signing out otherwise left every record the last person opened
 * readable offline by whoever sat down next. There is no service worker now - the app is not
 * served over a network and has nothing to cache against one - so the button is only a button.
 */
export function LockButton() {
  return (
    <button className="btn" data-variant="ghost">
      Lock
    </button>
  );
}
