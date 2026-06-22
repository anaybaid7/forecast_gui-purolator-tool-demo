# Teams integration — notes for a "random match" feature

These are some notes on an idea I keep coming back to: letting people get
matched into a Battleship game with someone from the same Teams meeting or
calendar invite, instead of having to manually share a room code in chat.
Right now the room-code flow works fine for our intern events because
everyone's already grouped together, but if we ever want to run this as a
broader "take a 5 minute break and battle a random coworker" thing, manually
pairing people doesn't scale.

## What I'd actually want

The simplest version: someone opens the game, clicks "Find an opponent from
my team," and the app looks at who else is currently in the same Teams
meeting (or who's on the same calendar invite) and pairs them with someone
who's also looking for a match. If nobody else is waiting, they just get a
room code like normal and can share it manually.

This doesn't need to be fancy — it's basically using Teams as a "who's
around right now and probably also bored" signal, rather than building our
own presence system from scratch.

## Why Teams API access would help

A few things become possible once we have Graph API access scoped to Teams:

- **Pulling meeting attendees.** If someone launches the game from inside a
  Teams meeting (via a tab or a shared link dropped in chat), we can read
  the attendee list for that meeting and use it as the "pool" for random
  matching. This is the cleanest version of the feature because the pool is
  naturally small and relevant — it's literally the people on the call.

- **Calendar-based matching.** Alternatively, if we go through someone's
  calendar (with their consent, obviously), we could match people who have a
  recurring meeting together, like a team standup. That's a bit more
  "matchmaking by org chart" but might be useful for larger groups where a
  live meeting isn't happening.

- **Presence status.** Teams presence (Available / Busy / Away) could be
  used to filter out people who are clearly mid-task, so we're not pinging
  someone who's heads-down in a deadline. Not essential, but it'd make the
  random-match feature feel less intrusive.

## Rough shape of how it'd plug in

On the server side, this would live alongside the existing room manager
rather than replacing it. The current flow is: create a room → get a code →
share the code → opponent joins. Random match would just be a different
entry point that *generates* the room and *auto-fills* the second player,
using whatever name Teams reports for them. Everything downstream — ship
placement, the leaderboard aggregation, board sizing — stays exactly the
same, since from the room manager's point of view it's still just two named
players in a room.

The leaderboard already keys off the player's display name, so as long as we
pull a consistent display name from Teams (their actual name, not some
session-specific ID), their stats would aggregate correctly across games the
same way they do now for two people typing the same callsign twice.

## What we'd need from IT / Graph API setup

- An app registration in Azure AD with delegated permissions for something
  like `OnlineMeetings.Read` (to get attendee lists) and possibly
  `Calendars.Read` if we go the calendar-matching route.
- Some way to get a user's access token into the game session — most likely
  this means running the game as a Teams tab app (using the Teams JS SDK),
  since that gives us an SSO token we can exchange for a Graph token without
  building a separate login flow.
- A decision on data handling: we'd only want to read attendee *names*, not
  store anything from Teams long-term. The leaderboard already only stores a
  display name + win/loss/accuracy numbers, so this shouldn't change our
  data footprint much, but worth flagging to whoever signs off on the app
  registration.

## A pattern we already have that fits here

While building out the board-size option, I ended up needing a "one player
proposes, the other confirms" flow — if Falcon wants to switch to an 8x8
board mid-setup, Jessica gets an accept/decline prompt instead of the board
just changing under her. That handshake (propose → notify the other side →
wait for accept/decline → apply or revert) is basically the same shape as
"invite a coworker to a match and wait for them to accept."

So when the random-match feature comes together, it doesn't need a brand
new accept/decline system — it can reuse this. The Teams piece just becomes
a different *trigger* for the same proposal: instead of clicking "Propose"
on the board-size control, the trigger is "Player A picks 'Find an opponent
from my Teams meeting,' the app sends a proposal to whoever Teams says is
available, and that person gets the same kind of accept/decline prompt
(just delivered via a Teams notification/card instead of an in-game popup)."
That keeps the core game logic untouched — Teams is just another way to
get two named players into a room and have them confirm they're both ready
to play.

## Open questions

- Do we want random matching to be opt-in per session, or does clicking
  "Find an opponent" implicitly consent to sharing your name with whoever
  you get matched with? (Probably opt-in, and probably fine either way since
  it's just a callsign, but worth being explicit.)
- If someone declines the match or doesn't respond, what's the timeout
  before we either re-pool them or fall back to a manual room code?
- Is this worth doing as a Teams tab specifically, or would a "Copy invite
  link" button that drops a room code into the Teams chat (using the share
  dialog, no Graph API needed) get us 80% of the value for a fraction of the
  setup? Honestly this might be the better first step — get Graph API access
  later if the manual-share version takes off and people actually want
  auto-matching.

None of this needs to happen before the API access is sorted out — the game
itself doesn't depend on it. This is just so that if/when we do get the
access, there's a starting point for what to build instead of starting from
a blank page.
