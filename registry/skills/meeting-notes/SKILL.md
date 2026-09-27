---
name: meeting-notes
description: Turns a meeting transcript, recording summary, or rough notes into clean, structured meeting notes with decisions, action items (owner and due date), open questions, and a short summary. Use when given a transcript or notes from a meeting, standup, interview, or call, or when asked to write up or summarize a meeting.
category: productivity
tags: [meetings, notes, summaries, action-items]
author: ShivankK26
---

# Meeting notes

Produce notes that someone who missed the meeting can read in two minutes and know exactly what was decided and what they need to do.

## Steps

1. **Read the whole input first.** It may be a raw transcript with speaker labels, auto-generated captions, bullet notes, or a mix. Identify the meeting's purpose, the attendees, and the date if they're given.
2. **Extract, don't transcribe.** Pull out:
   - **Decisions:** things that were agreed, including what was explicitly rejected.
   - **Action items:** a specific task, one owner, and a due date if one was mentioned. Turn vague commitments ("I'll look into it") into concrete tasks, attributed to the person who said them.
   - **Open questions:** unresolved issues, disagreements, and things waiting on someone outside the meeting.
   - **Key discussion points:** the reasoning behind decisions, important numbers, risks raised, and alternatives considered.
3. **Condense.** Merge repeated points, drop small talk and filler, and keep the reasoning behind decisions short. Use the speaker's own terminology for product names, projects, and metrics.
4. **Fill in the template** in [assets/template.md](assets/template.md). Leave out sections that would be empty, except Action items. If there are none, write "No action items."

## Accuracy rules

- Never invent owners, dates, numbers, or decisions. If an action item has no clear owner, write **Owner: unassigned** and list it under open questions too.
- Keep relative dates as they were said ("by Friday") unless the meeting date is known, in which case convert them to exact dates, for example "Fri 3 Oct".
- If the transcript is ambiguous or garbled at an important point, say so ("unclear from the transcript whether the launch moves to Q3") rather than guessing.
- Attribute statements to people only when the transcript makes the speaker clear.
- Leave out sensitive personal remarks, side conversations, and anything said explicitly off the record.

## Output

Return the notes as markdown. If the user asks for a follow-up email, add a short version after the notes: a greeting, the two-sentence summary, the decisions, and the action items with owners, ready to paste.
