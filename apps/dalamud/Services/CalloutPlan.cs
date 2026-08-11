namespace TournamentControl.Dalamud.Services;

public sealed record CalloutLine(string? Text, int ExpandedLength, string? Error)
{
    public bool HasMessage => Text is not null;
}

public sealed record CalloutPlan(CalloutLine First, CalloutLine Second, TimeSpan Delay)
{
    public bool HasMessages => First.HasMessage || Second.HasMessage;
    public bool IsValid => First.Error is null && Second.Error is null && HasMessages;
}
