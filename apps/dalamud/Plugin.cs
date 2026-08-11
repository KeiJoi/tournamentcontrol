using Dalamud.Game.Command;
using Dalamud.IoC;
using Dalamud.Interface.Windowing;
using Dalamud.Plugin;
using Dalamud.Plugin.Services;
using TournamentControl.Dalamud.Services;
using TournamentControl.Dalamud.Windows;

namespace TournamentControl.Dalamud;

public sealed class Plugin : IDalamudPlugin
{
    private const string CommandName = "/tourney";
    private readonly MainWindow mainWindow;
    private readonly WindowSystem windowSystem = new("TournamentBracketController");

    [PluginService] internal static IDalamudPluginInterface PluginInterface { get; private set; } = null!;
    [PluginService] internal static IPluginLog Log { get; private set; } = null!;
    [PluginService] internal static ICommandManager CommandManager { get; private set; } = null!;
    [PluginService] internal static IChatGui ChatGui { get; private set; } = null!;

    public Plugin()
    {
        Configuration = PluginInterface.GetPluginConfig() as Configuration ?? new Configuration();
        mainWindow = new MainWindow(Configuration, new TournamentApiClient(new HttpClient { Timeout = TimeSpan.FromSeconds(10) }), new MatchCalloutService(ChatGui));
        windowSystem.AddWindow(mainWindow);
        PluginInterface.UiBuilder.Draw += windowSystem.Draw;
        PluginInterface.UiBuilder.OpenMainUi += ToggleMainUi;
        PluginInterface.UiBuilder.OpenConfigUi += ToggleMainUi;
        CommandManager.AddHandler(CommandName, new CommandInfo((_, _) => ToggleMainUi()) { HelpMessage = "Open Tournament Bracket Controller." });
        Log.Information("Tournament Bracket Controller loaded.");
    }

    public string Name => "Tournament Bracket Controller";
    public Configuration Configuration { get; }
    public void Dispose()
    {
        PluginInterface.UiBuilder.Draw -= windowSystem.Draw;
        PluginInterface.UiBuilder.OpenMainUi -= ToggleMainUi;
        PluginInterface.UiBuilder.OpenConfigUi -= ToggleMainUi;
        CommandManager.RemoveHandler(CommandName);
        windowSystem.RemoveAllWindows();
        mainWindow.Dispose();
    }
    private void ToggleMainUi() => mainWindow.Toggle();
}
