namespace TournamentControl.Dalamud.Services;

public static class CalloutSequence
{
    public static async Task ExecuteAsync(
        CalloutPlan plan,
        Func<string, Task> sendAsync,
        Func<TimeSpan, CancellationToken, Task> delayAsync,
        CancellationToken cancellationToken)
    {
        if (!plan.IsValid) throw new ArgumentException("The callout plan is invalid or has no messages.", nameof(plan));

        if (plan.First.Text is { } first) await sendAsync(first);
        if (plan.First.HasMessage && plan.Second.HasMessage) await delayAsync(plan.Delay, cancellationToken);
        if (plan.Second.Text is { } second) await sendAsync(second);
    }
}
