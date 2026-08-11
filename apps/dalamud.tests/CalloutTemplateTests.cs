using TournamentControl.Dalamud;
using TournamentControl.Dalamud.Services;
using Xunit;

namespace TournamentControl.Dalamud.Tests;

public sealed class CalloutTemplateTests
{
    [Fact]
    public void Replaces_both_placeholders_including_repeated_occurrences()
    {
        var line = CalloutTemplate.Prepare("<1> vs <2>: <1> / <2>", "Tom", "Jerry");
        Assert.Equal("Tom vs Jerry: Tom / Jerry", line.Text);
    }

    [Fact]
    public void Default_templates_produce_expected_shout_and_yell_commands()
    {
        var plan = CalloutTemplate.CreatePlan("WILL <1> and <2> COME ON DOWN!", "You are the next victims in this tournament!", 2000, "Tom", "Jerry");
        Assert.Equal("WILL Tom and Jerry COME ON DOWN!", plan.First.Text); Assert.Equal("You are the next victims in this tournament!", plan.Second.Text); Assert.Equal(TimeSpan.FromSeconds(2), plan.Delay);
        Assert.Equal("/shout WILL Tom and Jerry COME ON DOWN!", CalloutTemplate.Command(CalloutChannel.Shout) + " " + plan.First.Text);
        Assert.Equal("/shout You are the next victims in this tournament!", CalloutTemplate.Command(CalloutChannel.Shout) + " " + plan.Second.Text);
        Assert.Equal("/yell WILL Tom and Jerry COME ON DOWN!", CalloutTemplate.Command(CalloutChannel.Yell) + " " + plan.First.Text);
        Assert.Equal("/yell You are the next victims in this tournament!", CalloutTemplate.Command(CalloutChannel.Yell) + " " + plan.Second.Text);
    }

    [Fact]
    public void Leaves_unknown_placeholders_literal()
    {
        Assert.Equal("Tom <3>", CalloutTemplate.Prepare("<1> <3>", "Tom", "Jerry").Text);
    }

    [Fact]
    public void Supports_unicode_names_and_removes_control_character_injection()
    {
        var line = CalloutTemplate.Prepare("WILL <1> and <2>\nCOME", "Éowyn\r", "勇者\u0001");
        Assert.Equal("WILL Éowyn and 勇者 COME", line.Text);
    }

    [Fact]
    public void Blank_lines_are_skipped_and_both_blank_is_invalid()
    {
        var oneLine = CalloutTemplate.CreatePlan("", "Hello <2>", 2000, "Tom", "Jerry");
        Assert.True(oneLine.IsValid); Assert.False(oneLine.First.HasMessage); Assert.Equal("Hello Jerry", oneLine.Second.Text);
        var firstOnly = CalloutTemplate.CreatePlan("Hello <1>", "", 2000, "Tom", "Jerry");
        Assert.True(firstOnly.IsValid); Assert.Equal("Hello Tom", firstOnly.First.Text); Assert.False(firstOnly.Second.HasMessage);
        var empty = CalloutTemplate.CreatePlan("", "", 2000, "Tom", "Jerry");
        Assert.False(empty.IsValid); Assert.False(empty.HasMessages);
    }

    [Fact]
    public void Rejects_overlong_expanded_messages()
    {
        var line = CalloutTemplate.Prepare(new string('x', CalloutTemplate.MaximumMessageLength + 1), "Tom", "Jerry");
        Assert.Null(line.Text); Assert.NotNull(line.Error); Assert.Equal(501, line.ExpandedLength);
    }

    [Theory]
    [InlineData(CalloutChannel.Shout, "/shout")]
    [InlineData(CalloutChannel.Yell, "/yell")]
    public void Maps_only_supported_channels(CalloutChannel channel, string command) => Assert.Equal(command, CalloutTemplate.Command(channel));

    [Fact]
    public async Task Sequences_two_lines_with_one_delay()
    {
        var sent = new List<string>(); var delays = new List<TimeSpan>();
        var plan = CalloutTemplate.CreatePlan("one", "two", 2000, "Tom", "Jerry");
        await CalloutSequence.ExecuteAsync(plan, message => { sent.Add(message); return Task.CompletedTask; }, (delay, _) => { delays.Add(delay); return Task.CompletedTask; }, CancellationToken.None);
        Assert.Equal(["one", "two"], sent); Assert.Equal([TimeSpan.FromSeconds(2)], delays);
    }

    [Fact]
    public async Task Does_not_delay_when_one_line_is_blank()
    {
        var sent = new List<string>(); var delayed = false;
        var plan = CalloutTemplate.CreatePlan("", "two", 2000, "Tom", "Jerry");
        await CalloutSequence.ExecuteAsync(plan, message => { sent.Add(message); return Task.CompletedTask; }, (_, _) => { delayed = true; return Task.CompletedTask; }, CancellationToken.None);
        Assert.Equal(["two"], sent); Assert.False(delayed);
    }

    [Fact]
    public async Task Cancels_before_the_second_line()
    {
        var sent = new List<string>(); using var cancellation = new CancellationTokenSource();
        var plan = CalloutTemplate.CreatePlan("one", "two", 2000, "Tom", "Jerry");
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => CalloutSequence.ExecuteAsync(plan, message => { sent.Add(message); return Task.CompletedTask; }, (_, token) => { cancellation.Cancel(); return Task.FromCanceled(token); }, cancellation.Token));
        Assert.Equal(["one"], sent);
    }

    [Fact]
    public void Prevents_duplicate_sends_and_applies_a_short_cooldown()
    {
        var time = DateTimeOffset.UtcNow; var gate = new CalloutDispatchGate(() => time);
        Assert.True(gate.TryStart("match-1", out _)); Assert.True(gate.IsActive("match-1")); Assert.False(gate.TryStart("match-1", out _));
        gate.Finish("match-1"); Assert.False(gate.CanStart("match-1", out _)); time = time.AddSeconds(2); Assert.True(gate.CanStart("match-1", out _));
    }
}
