using Dalamud.Game.Text;
using Dalamud.Plugin.Services;

namespace TournamentControl.Dalamud.Services;

public sealed class MatchCalloutService(IChatGui chatGui) : IDisposable
{
    private readonly CancellationTokenSource lifetime = new();
    private readonly object gate = new();
    private readonly CalloutDispatchGate dispatchGate = new();
    private readonly Dictionary<string, string> statuses = [];

    public bool IsSending(string matchId) => dispatchGate.IsActive(matchId);
    public string? GetStatus(string matchId) { lock (gate) return statuses.GetValueOrDefault(matchId); }

    public bool CanSend(string matchId, out string? reason)
    {
        if (lifetime.IsCancellationRequested) { reason = "Callouts are unavailable while the plugin is shutting down."; return false; }
        return dispatchGate.CanStart(matchId, out reason);
    }

    public bool TrySend(string matchId, CalloutChannel channel, string line1, string line2, int delayMilliseconds, string player1, string player2)
    {
        if (string.IsNullOrWhiteSpace(player1) || string.IsNullOrWhiteSpace(player2)) { lock (gate) statuses[matchId] = "Both match contestants are required for a callout."; return false; }
        var plan = CalloutTemplate.CreatePlan(line1, line2, delayMilliseconds, player1, player2);
        if (!plan.IsValid)
        {
            lock (gate) statuses[matchId] = plan.HasMessages ? plan.First.Error ?? plan.Second.Error! : "Configure at least one callout line first.";
            return false;
        }
        string? reason = null;
        if (lifetime.IsCancellationRequested || !dispatchGate.TryStart(matchId, out reason)) { lock (gate) statuses[matchId] = reason ?? "Callouts are unavailable while the plugin is shutting down."; return false; }
        lock (gate) statuses[matchId] = "Sending callout…";
        _ = SendCoreAsync(matchId, channel, plan);
        return true;
    }

    private async Task SendCoreAsync(string matchId, CalloutChannel channel, CalloutPlan plan)
    {
        try
        {
            await CalloutSequence.ExecuteAsync(plan, message =>
            {
                Send(channel, message);
                return Task.CompletedTask;
            }, Task.Delay, lifetime.Token);
            lock (gate) statuses[matchId] = "Callout sent.";
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
            lock (gate) statuses[matchId] = "Callout cancelled.";
        }
        catch (Exception)
        {
            // Chat can become unavailable between lines (logout, unload, or service failure). Do not retry or fault a fire-and-forget UI action.
            lock (gate) statuses[matchId] = "Callout could not be sent; check chat availability.";
        }
        finally
        {
            dispatchGate.Finish(matchId);
        }
    }

    private void Send(CalloutChannel channel, string message) => chatGui.Print(new XivChatEntry
    {
        Type = channel == CalloutChannel.Yell ? XivChatType.Yell : XivChatType.Shout,
        Message = message,
        Silent = false,
    });

    public void Dispose()
    {
        lifetime.Cancel();
        lifetime.Dispose();
    }
}
