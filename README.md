```
██████╗ ██████╗ ██████╗  ██████╗ ██████╗  ██████╗ ██████╗  ██████╗ ██████╗  ██████╗ ████████╗
██╔══██╗██╔══██╗██╔══██╗██╔═══██╗╚════██╗██╔═████╗╚════██╗██╔═████╗██╔══██╗██╔═══██╗╚══██╔══╝
██████╔╝██████╔╝██████╔╝██║   ██║ █████╔╝██║██╔██║ █████╔╝██║██╔██║██████╔╝██║   ██║   ██║
██╔═══╝ ██╔═══╝ ██╔══██╗██║   ██║██╔═══╝ ████╔╝██║██╔═══╝ ████╔╝██║██╔══██╗██║   ██║   ██║
██║     ██║     ██║  ██║╚██████╔╝███████╗╚██████╔╝███████╗╚██████╔╝██████╔╝╚██████╔╝   ██║
╚═╝     ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝  ╚═════╝    ╚═╝
```






> [!NOTE]
> Project is not finished and optimised yet so don't expect it to work well

# A discord bot made using [Discordjs14](https://discord.js.org/)

1. Functionnalities:
    - [x] Basic command handler with slash commands support
    - [x] Math expression printer (deployed using KaTex and pupeteer)
2. To do:
    - [x] Moderation commands
    - [ ] Math graphs and functions rendering

## Music command

The `/music` command plays audio files from the bot's local `music` folder. Add audio that you own or are licensed to play, then use `/music play` and select a file from the autocomplete list. `/music soundcloud` searches SoundCloud and returns an official results link; SoundCloud, Spotify, and YouTube Music streams are not played by this bot.

Available subcommands are `/music play`, `/music pause`, `/music resume`, `/music skip`, `/music queue`, `/music volume`, and `/music stop`. Volume ranges from 0 to 100. The bot needs Connect and Speak permissions in the voice channel.

After installing dependencies, run `node deploy-commandsg.js` to register the command in the configured guild. Supported file types are MP3, WAV, OGG, FLAC, AAC, and M4A.

Playback uses FFmpeg. `ffmpeg-static` is included; if your package manager blocks its install script, install FFmpeg separately and make sure `ffmpeg` is available on `PATH`.

## Moderation commands

Run `node deploy-commandsg.js` to register the moderation commands in the configured server. A moderator with **Manage Server** should first run `/setmodlog` and choose a text channel. Successful moderation actions are then recorded there as embeds; the bot needs View Channel and Send Messages access. Log channel settings and warnings are stored in `data/moderation.json`.

Each action is a separate command: `/ban`, `/unban`, `/kick`, `/timeout`, `/untimeout`, `/warn`, `/warnings`, `/clear`, `/slowmode`, `/lock`, `/unlock`, `/setmodlog`, and `/userinfo`. Actions check the caller’s Discord permissions and role hierarchy. `/userinfo` shows the user ID, account creation date, server join date, and roles. Message deletion is limited by Discord’s 14-day bulk-delete restriction.

The moderation commands and their shared implementation are in `commands/mod`. Copy the complete folder, including `moderation.cjs`, to your bot. The Discord voice library is loaded only when `/music play` is used, so registering slash commands does not require its native audio bindings to load.

The deploy scripts skip duplicate slash-command names, which helps if an older bundled `commands/mod/mod.js` is still present in an existing install. You can remove that obsolete file after copying the individual moderation command files.

