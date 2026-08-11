namespace TournamentControl.Dalamud.Services;

public sealed class CalloutDispatchGate
{
    private static readonly TimeSpan Cooldown = TimeSpan.FromSeconds(2);
    private readonly object gate = new();
    private readonly HashSet<string> activeMatches = [];
    private readonly Dictionary<string, DateTimeOffset> lastStarted = [];
    private readonly Func<DateTimeOffset> now;

    public CalloutDispatchGate(Func<DateTimeOffset>? now = null) => this.now = now ?? (() => DateTimeOffset.UtcNow);
    public bool IsActive(string matchId) { lock (gate) return activeMatches.Contains(matchId); }
    public bool CanStart(string matchId, out string? reason)
    {
        lock (gate)
        {
            if (activeMatches.Contains(matchId)) { reason = "Sending callout…"; return false; }
            if (lastStarted.TryGetValue(matchId, out var last) && now() - last < Cooldown) { reason = "Please wait briefly before calling this match again."; return false; }
        }
        reason = null;
        return true;
    }
    public bool TryStart(string matchId, out string? reason)
    {
        lock (gate)
        {
            if (activeMatches.Contains(matchId)) { reason = "Sending callout…"; return false; }
            if (lastStarted.TryGetValue(matchId, out var last) && now() - last < Cooldown) { reason = "Please wait briefly before calling this match again."; return false; }
            activeMatches.Add(matchId); lastStarted[matchId] = now();
        }
        reason = null;
        return true;
    }
    public void Finish(string matchId) { lock (gate) activeMatches.Remove(matchId); }
}
