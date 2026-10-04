/**
 * The Sarcastic Colleague, English. Dry irony about the situation, never about the person
 * (docs/specs/2026-10-morning-partner.md).
 * Each line: [subject and opening line, follow-up]. {count}, {weekday}; {item} only in the follow-up.
 * A line's id is its position: add new lines at the end of a list, never reorder or delete.
 */
module.exports = {
  all_clear: [
    ['Nothing overdue? Who are you and what did you do with you?', 'Enjoy it. Here’s what’s new.'],
    ['Zero overdue. Frame this email.', 'New things did arrive, of course.'],
    ['Nothing late. Suspicious, but congratulations.', 'Have a look at what came in.'],
    ['Caught up. I’m almost out of material.', 'Almost. There’s new stuff below.'],
    ['No overdue items. Mark the calendar.', 'And look at what’s new while you’re at it.'],
    ['Nothing overdue. Your to-do list is speechless.', 'Mostly. New items below.'],
    ['All clear on a {weekday}. Who even are you?', 'The new stuff is below. No pressure.'],
    ['Nothing overdue. Don’t let it go to your head.', 'Fine, a little. Then check what’s new.']
  ],
  due_today: [
    ['Something’s due today. Bold of it to assume you’d remember.', 'Now you do. Start with {item}.'],
    ['Today is the due date. Today. As in today.', 'Just checking we’re aligned.'],
    ['A deadline walks into your {weekday}…', 'There’s no punchline. Just {item}.'],
    ['Due today, a classic of the genre.', 'Spoiler: it ends with you finishing it.'],
    ['Today’s deadline sends its regards.', 'It would love to hear from you before 5.'],
    ['Your future self called. Something’s due today.', 'They’d like it done. Start with {item}.'],
    ['Due today. Imagine finishing it before lunch.', 'Wild idea, I know.'],
    ['Something’s due today. It won’t do itself. I checked.', 'Open it first thing.']
  ],
  overdue_few: [
    ['Something’s overdue. It’s not going anywhere. The deadline did.', 'Spoiler: {item} is still waiting.'],
    ['{count} overdue. They miss you.', '{item} especially.'],
    ['An overdue item sends its regards.', 'It’s been very patient. Mostly.'],
    ['{count} overdue. They’re starting to feel at home.', 'Maybe show them the door today.'],
    ['Overdue, but in a charming way.', 'Charm wears off. Start with {item}.'],
    ['Your overdue list is small but committed.', 'Ten minutes and it’s history.'],
    ['{count} overdue. Not a crisis. Yet.', 'Let’s keep it boring. Do {item}.'],
    ['Plot twist: the overdue thing is still overdue.', 'The sequel where you finish it is due.']
  ],
  overdue_pile: [
    ['{count} overdue. At this point they’re not tasks, they’re roommates.', 'Time to charge rent. Start with {item}.'],
    ['{count} overdue. They’ve started a group chat.', 'Break it up. Start with {item}.'],
    ['{count} overdue. Collecting them all, apparently.', 'Or finish one. Also an option.'],
    ['{count} overdue. It’s a collection now.', 'Collectors do sell sometimes. Close one.'],
    ['{count} overdue. They’ve unionized.', 'Their one demand: get done. Start with {item}.'],
    ['{count} overdue. Bold strategy. Let’s see how it plays out.', 'Or pick one and finish it. Your call.'],
    ['{count} overdue. Even the calendar is concerned.', 'Close one before lunch and it’ll relax.'],
    ['{count} overdue on a {weekday}. A tradition is forming.', 'Traditions can be broken. Start with one.']
  ],
  // 6 or more: the jokes stop and it helps triage (spec, point 5)
  overloaded: [
    ['{count} overdue. Even I won’t joke about this.', 'Pick the one that matters. Move the rest.'],
    ['{count} overdue. Jokes paused. Triage time.', 'Keep a few. Reschedule or drop the others.'],
    ['{count} overdue. Honestly? Some of these can go.', 'Drop the dead ones, date the rest, do one today.'],
    ['{count} overdue. Not all of it is today’s problem.', 'One that matters today. Real dates for the rest.'],
    ['{count} overdue. Sarcasm off. Plan on.', 'Ten minutes sorting saves the week.'],
    ['{count} overdue. Nobody does all of that in a day.', 'Choose one. That’s a good day.'],
    ['{count} overdue. Time for an honest cleanup.', 'Some may not even be yours. Check, then move them.'],
    ['{count} overdue. Let’s make the list smaller.', 'Drop, reschedule, then finish one.']
  ],
  prep_only: [
    ['Meetings today. Fun fact: people remember who owes what.', 'The open items are below.'],
    ['Meeting day. Arrive knowing things. Imagine.', 'Open items with these people, below.'],
    ['You have meetings. I have notes. Let’s combine.', 'Here’s what’s pending with them.'],
    ['Meetings ahead. Walk in like you read the notes.', 'Conveniently, they’re below.'],
    ['{weekday} meetings. Being prepared is a good look.', 'The pending items are below.'],
    ['Meeting prep, the least glamorous superpower.', 'Two minutes with the list below.'],
    ['Another meeting day. At least you’ll be ready.', 'Here’s who owes what.'],
    ['Meetings today. Spoiler: someone will ask for a status.', 'Have the answer. It’s below.']
  ]
};
