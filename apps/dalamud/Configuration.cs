using Dalamud.Configuration;

namespace TournamentControl.Dalamud;

[Serializable]
public sealed class Configuration : IPluginConfiguration
{
    public int Version { get; set; } = 1;

    // Connection credentials stay in the local Dalamud configuration and are never sent to public endpoints.
    public string ServerUrl { get; set; } = "";
    public string ServerAccessPassword { get; set; } = "";
    public string UserKey { get; set; } = "";

    public CalloutChannel CalloutChannel { get; set; } = CalloutChannel.Shout;
    public string CalloutLine1 { get; set; } = "WILL <1> and <2> COME ON DOWN!";
    public string CalloutLine2 { get; set; } = "You are the next victims in this tournament!";
    public int CalloutDelayMilliseconds { get; set; } = 2000;

    public void Save() => Plugin.PluginInterface.SavePluginConfig(this);
}
