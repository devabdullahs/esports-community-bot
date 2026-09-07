# Loading feedback and daily shortcuts

The homepage now gives the existing daily feed, predictions, and EWC club standings prominent localized entry points. The former sidebar prediction promotion is removed. The shortcuts add no server queries or background requests.

The global loading fallback renders synchronously, with a content skeleton and indeterminate loading treatment. A real elapsed-wait counter remains visible when reduced motion disables animation. After ten seconds, the loader explains the delay and offers an explicit reload action. It never reloads automatically or shows an invented completion percentage.

Header and daily-shortcut links use Next's pending-link state to show immediate feedback while navigation is waiting for its first response. The previous content remains usable. Wait counters stop when the indicator unmounts.

Verification covers English and Arabic, phone and desktop layouts, delayed recovery, timer cleanup, simulated slow navigation, reduced motion, and localized shortcut destinations. No API methods or authorization policies changed.
