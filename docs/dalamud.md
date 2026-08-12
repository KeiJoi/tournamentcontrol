# Dalamud controller

The plugin targets .NET 10 and Dalamud API 15 through `Dalamud.NET.Sdk/15.0.0`. It uses ImGui windows, `HttpClient` for REST, and `ClientWebSocket` for real-time events. It never references TypeScript shared packages or embeds server secrets.

Connection configuration contains server URL, server access password, and user key locally using Dalamud configuration facilities. The server password/user key are sent only to authenticated controller endpoints over TLS and must not appear in logs/UI diagnostics. The settings window intentionally begins with empty password/key fields rather than reading saved values back into the UI. Current official API-15 references used for this project do not document an OS-backed secret-store service for third-party plugins, so Dalamud’s normal plugin configuration persistence is used; this may leave credentials recoverable by someone with access to the local plugin configuration. Operators should secure that account/device.

## Match callouts

Callout preferences are local plugin settings, not tournament data. The configuration page offers only the `Shout` and `Yell` enum values, mapped internally to `/shout` and `/yell`; arbitrary commands cannot be supplied. Defaults are `WILL <1> and <2> COME ON DOWN!`, `You are the next victims in this tournament!`, and a two-second delay (bounded to 0.5–10 seconds).

`<1>` and `<2>` are replaced with the two selected-match contestants at send time. Other placeholder-like text remains literal. Template newlines become spaces; control characters are removed from templates and names so a callout cannot create extra chat commands. Expanded lines are limited to 500 characters; an overlong template is rejected rather than truncated. Blank lines are skipped, and both blank lines disable sending. The preview uses configurable fake names and never sends chat.

The operator must explicitly press `CALL PLAYERS` for a ready match with two actual contestants; callouts are never automatic. A match has an in-progress guard and a short local cooldown, with no automatic retries. Sending is queued through `IChatGui.Print` with `XivChatEntry.Type` set to `XivChatType.Shout` or `XivChatType.Yell`. The second line uses cancellation-aware asynchronous delay; plugin unload cancels it, and chat failures (including unavailability between lines) are caught and shown as a concise UI status.

## Live match navigation

The active controller groups matches into one tab per authoritative bracket round. Match labels use a stable global number: every first-round match comes first, followed by every second-round match, and so on. Selecting a winner opens an immediate confirmation popup, so the operator never has to scroll through a full bracket to confirm the selected result.

The unit tests in `apps/dalamud.tests` cover default Shout/Yell command construction, expansion, repeated and unknown placeholders, blank-line behavior, Unicode/control-character sanitization, length validation, delay sequencing, cancellation, and duplicate/cooldown prevention. They do not require a live FFXIV client.

## Manual in-game checklist

- Open `/tourney`, save callout settings, reload the plugin, and confirm the channel/templates/delay persist locally without displaying saved credentials.
- Confirm the preview for Tom and Jerry exactly matches the configured channel and never sends chat.
- With a ready match containing two contestants, press `CALL PLAYERS` once and verify the selected Shout or Yell channel, two-second default delay, and disabled in-progress/cooldown state.
- Confirm a bye, future match, or a match with a missing contestant does not offer an enabled callout action.
- Begin a two-line callout, then unload the plugin or leave a state where chat is unavailable; confirm no second line is sent and the UI reports a concise failure/cancellation status.
