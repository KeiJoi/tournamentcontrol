namespace TournamentControl.Dalamud.Services;

public static class CalloutTemplate
{
    public const int MaximumMessageLength = 500;
    public const int MinimumDelayMilliseconds = 500;
    public const int MaximumDelayMilliseconds = 10_000;

    public static string Render(string template, string firstContestant, string secondContestant) => Sanitize(template)
        .Replace("<1>", SanitizeName(firstContestant), StringComparison.Ordinal)
        .Replace("<2>", SanitizeName(secondContestant), StringComparison.Ordinal);

    public static string Command(CalloutChannel channel) => channel == CalloutChannel.Yell ? "/yell" : "/shout";

    public static CalloutPlan CreatePlan(string line1, string line2, int delayMilliseconds, string firstContestant, string secondContestant) => new(
        Prepare(line1, firstContestant, secondContestant),
        Prepare(line2, firstContestant, secondContestant),
        TimeSpan.FromMilliseconds(Math.Clamp(delayMilliseconds, MinimumDelayMilliseconds, MaximumDelayMilliseconds)));

    public static CalloutLine Prepare(string template, string firstContestant, string secondContestant)
    {
        var expanded = Render(template ?? string.Empty, firstContestant ?? string.Empty, secondContestant ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(expanded)) return new CalloutLine(null, 0, null);
        return expanded.Length > MaximumMessageLength
            ? new CalloutLine(null, expanded.Length, $"Message is {expanded.Length - MaximumMessageLength} characters over the {MaximumMessageLength}-character limit.")
            : new CalloutLine(expanded, expanded.Length, null);
    }

    // Newlines become spaces and other control characters are removed so one callout cannot become multiple chat commands.
    public static string Sanitize(string value) => new((value ?? string.Empty).Select(character => character is '\r' or '\n' ? ' ' : character).Where(character => !char.IsControl(character)).ToArray());
    private static string SanitizeName(string value) => new((value ?? string.Empty).Where(character => !char.IsControl(character)).ToArray());
}
