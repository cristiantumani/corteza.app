/**
 * The Sergeant, English. Tough love, short and direct (docs/specs/2026-10-morning-partner.md).
 * Each line: [subject and opening line, follow-up]. {count}, {weekday}; {item} only in the follow-up.
 * A line's id is its position: add new lines at the end of a list, never reorder or delete.
 */
module.exports = {
  all_clear: [
    ['Nothing overdue. Good. Don’t get comfortable.', 'New stuff came in. Look it over and stay ahead.'],
    ['Clean slate. That’s how it’s done.', 'Keep it that way. Check what’s new.'],
    ['Zero overdue. Outstanding. Now stay sharp.', 'Fresh items below. Deal with them early.'],
    ['No overdue items. Mission on track.', 'Review the new ones before they pile up.'],
    ['All clear on {weekday}. Hold the line.', 'Here’s what came in. Stay ahead of it.'],
    ['Nothing late. That’s discipline.', 'Same standard today. Look at what’s new.'],
    ['You’re caught up. Earned, not given.', 'Keep moving. New items below.'],
    ['Nothing overdue. Now raise the bar.', 'Take a minute to see what landed.']
  ],
  due_today: [
    ['Due today. Done by noon. No debate.', 'Open it. Finish it. Then coffee.'],
    ['One target today. Hit it.', 'Start with: {item}.'],
    ['Deadline today. Eyes on it.', 'First thing: {item}.'],
    ['Today’s mission is on your desk.', 'No warm-up. Start now.'],
    ['Something’s due today. You know what to do.', 'Do it before the first meeting.'],
    ['Due today means today. Not “later”.', 'Block 30 minutes and close it.'],
    ['{weekday} deadline. Lock in.', 'Finish it, then everything else.'],
    ['Today it gets done. Period.', 'Begin with {item}.']
  ],
  overdue_few: [
    ['{count} overdue. Not tomorrow. Today.', 'Start with {item}.'],
    ['Overdue. Fix it before lunch.', 'One focused hour clears it.'],
    ['Late items don’t age well. Move.', 'Knock out {item} first.'],
    ['{count} overdue. Small pile. Crush it now.', 'Before it grows, finish it.'],
    ['You’re behind. Catch up today.', 'Open the first one and don’t stop.'],
    ['Overdue on {weekday}. Not acceptable. Fix it.', 'Start with {item}.'],
    ['Behind schedule. Close the gap today.', 'First item, first thing.'],
    ['{count} overdue. Excuses won’t close them.', 'Ten minutes now beats an hour later.']
  ],
  overdue_pile: [
    ['{count} overdue. Excuses don’t ship. You do. Move.', 'Start with {item}.'],
    ['{count} late. Time to march.', 'One at a time. First one now.'],
    ['{count} overdue. The pile won’t shrink itself.', 'Clear the oldest before your first meeting.'],
    ['{count} behind. Today we dig out.', 'Pick one. Finish it. Repeat.'],
    ['{count} overdue. Stop planning. Start finishing.', 'Begin with {item}.'],
    ['{count} items late. I want one done by noon.', 'Then the next.'],
    ['{count} overdue on a {weekday}. Turn it around.', 'Close one before you open your inbox.'],
    ['{count} overdue. Today you take back control.', 'Move the dates on the ones that can wait.']
  ],
  // 6 or more: supportive triage, never pushing (spec, point 5)
  overloaded: [
    ['{count} overdue is too many to fight at once. Pick one.', 'Win it. Then the next. Move or drop the rest.'],
    ['{count} overdue. New orders: triage.', 'Keep the 3 that matter. Reschedule the rest.'],
    ['{count} overdue. Regroup before you charge.', 'Choose one that matters and finish it today.'],
    ['{count} overdue. Nobody clears that in a day. Prioritize.', 'Pick today’s one. Give the rest real dates.'],
    ['{count} overdue. Strategy beats effort here.', 'Drop what’s dead. Date what’s alive.'],
    ['{count} overdue. Time to reset the plan.', 'Ten minutes of triage saves the week.'],
    ['{count} overdue. Smaller battles. Pick one.', 'Some of these may not even be yours. Check.'],
    ['{count} overdue. Breathe. Then pick one.', 'Done beats perfect. Reschedule the rest.']
  ],
  prep_only: [
    ['Meetings today. Walk in prepared.', 'Check the open items below first.'],
    ['Briefing time. Know your open items.', 'Five minutes now saves the meeting.'],
    ['Don’t walk in blind today.', 'Review who owes what before you join.'],
    ['Meeting day. Be the one who’s ready.', 'The open items are below.'],
    ['{weekday} meetings ahead. Prepare.', 'Scan the list. Follow up on what’s pending.'],
    ['Preparation wins meetings.', 'Read the open items before the first call.'],
    ['Show up ready. That’s the job.', 'Your prep notes are below.'],
    ['Meetings on deck. Get your facts straight.', 'Open items with these people, below.']
  ]
};
