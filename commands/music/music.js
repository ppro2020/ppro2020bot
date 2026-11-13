const fs = require('node:fs');
const path = require('node:path');
const {
	PermissionFlagsBits,
	SlashCommandBuilder,
} = require('discord.js');

const musicDirectory = path.join(__dirname, '..', '..', 'music');
const supportedExtensions = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const queues = new Map();
const maxQueueLength = 50;

function getAvailableTracks() {
	return fs.readdirSync(musicDirectory, { withFileTypes: true })
		.filter(entry => entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase()))
		.map(entry => entry.name);
}

function formatVolume(volume) {
	const filledSegments = Math.round(volume * 10);
	return `${'█'.repeat(filledSegments)}${'░'.repeat(10 - filledSegments)} ${Math.round(volume * 100)}%`;
}

class GuildMusicQueue {
	constructor(guild, voiceChannel, textChannel) {
		const {
			AudioPlayerStatus,
			createAudioPlayer,
			joinVoiceChannel,
			NoSubscriberBehavior,
			VoiceConnectionStatus,
		} = require('@discordjs/voice');

		this.audioPlayerStatus = AudioPlayerStatus;
		this.queue = [];
		this.currentTrack = null;
		this.currentResource = null;
		this.volume = 0.5;
		this.textChannel = textChannel;
		this.stopping = false;
		this.connection = joinVoiceChannel({
			channelId: voiceChannel.id,
			guildId: guild.id,
			adapterCreator: guild.voiceAdapterCreator,
			selfDeaf: true,
		});
		this.player = createAudioPlayer({
			behaviors: {
				noSubscriber: NoSubscriberBehavior.Pause,
			},
		});

		this.connection.subscribe(this.player);
		this.player.on(AudioPlayerStatus.Idle, () => {
			this.currentTrack = null;
			this.currentResource = null;
			this.playNext();
		});
		this.player.on('error', error => {
			console.error(`Unable to play ${this.currentTrack?.title ?? 'audio track'}:`, error);
			void this.textChannel.send('A track could not be played; moving to the next queued track.')
				.catch(sendError => console.error('Unable to report a playback error:', sendError));
			this.player.stop(true);
		});
		this.connection.on(VoiceConnectionStatus.Disconnected, () => {
			this.stop();
		});
	}

	enqueue(track) {
		if (this.queue.length >= maxQueueLength) {
			throw new Error(`The queue is limited to ${maxQueueLength} upcoming tracks.`);
		}

		this.queue.push(track);
		this.playNext();
	}

	playNext() {
		if (this.stopping || this.player.state.status !== this.audioPlayerStatus.Idle) {
			return;
		}

		const { createAudioResource } = require('@discordjs/voice');
		while (this.queue.length > 0) {
			const track = this.queue.shift();
			try {
				const resource = createAudioResource(track.filePath, { inlineVolume: true });
				resource.volume.setVolume(this.volume);
				this.currentTrack = track;
				this.currentResource = resource;
				this.player.play(resource);
				return;
			}
			catch (error) {
				console.error(`Unable to load ${track.title}:`, error);
				void this.textChannel.send(`Could not load **${track.title}**; moving to the next queued track.`)
					.catch(sendError => console.error('Unable to report a playback error:', sendError));
			}
		}
	}

	setVolume(volume) {
		this.volume = volume;
		this.currentResource?.volume?.setVolume(volume);
	}

	stop() {
		if (this.stopping) {
			return;
		}

		this.stopping = true;
		this.queue.length = 0;
		this.player.stop(true);
		this.connection.destroy();
		queues.delete(this.connection.joinConfig.guildId);
	}
}

function getQueue(guildId) {
	return queues.get(guildId);
}

function getVoiceChannel(interaction) {
	return interaction.guild.voiceStates.cache.get(interaction.user.id)?.channel ?? null;
}

function checkQueueControlAccess(interaction, musicQueue) {
	const voiceChannel = getVoiceChannel(interaction);
	return Boolean(voiceChannel && voiceChannel.id === musicQueue.connection.joinConfig.channelId);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('music')
		.setDescription('Play local audio or search SoundCloud')
		.addSubcommand(subcommand => subcommand
			.setName('soundcloud')
			.setDescription('Search SoundCloud and get an official results link')
			.addStringOption(option => option
				.setName('query')
				.setDescription('Track or artist to search for')
				.setRequired(true)
				.setMaxLength(100)))
		.addSubcommand(subcommand => subcommand
			.setName('play')
			.setDescription('Queue a local audio file')
			.addStringOption(option => option
				.setName('track')
				.setDescription('Audio file in the music folder')
				.setRequired(true)
				.setAutocomplete(true)))
		.addSubcommand(subcommand => subcommand
			.setName('pause')
			.setDescription('Pause the current track'))
		.addSubcommand(subcommand => subcommand
			.setName('resume')
			.setDescription('Resume the current track'))
		.addSubcommand(subcommand => subcommand
			.setName('skip')
			.setDescription('Skip the current track'))
		.addSubcommand(subcommand => subcommand
			.setName('queue')
			.setDescription('Show the current track queue'))
		.addSubcommand(subcommand => subcommand
			.setName('volume')
			.setDescription('Set playback volume')
			.addIntegerOption(option => option
				.setName('level')
				.setDescription('Volume from 0 to 100')
				.setMinValue(0)
				.setMaxValue(100)
				.setRequired(true)))
		.addSubcommand(subcommand => subcommand
			.setName('stop')
			.setDescription('Stop playback and leave the voice channel')),
	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused().toLowerCase();
		const tracks = getAvailableTracks()
			.filter(track => track.length <= 100 && track.toLowerCase().includes(focusedValue))
			.slice(0, 25);

		await interaction.respond(tracks.map(track => ({ name: track, value: track })));
	},
	async execute(interaction) {
		if (!interaction.inGuild()) {
			await interaction.reply({ content: 'Music commands are only available in a server.', ephemeral: true });
			return;
		}

		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'soundcloud') {
			const query = interaction.options.getString('query', true);
			const searchUrl = `https://soundcloud.com/search/sounds?q=${encodeURIComponent(query)}`;
			await interaction.reply(`SoundCloud results for **${query}**: ${searchUrl}\nOpen a track on SoundCloud to listen. SoundCloud streams cannot be played in this bot.`);
			return;
		}

		let musicQueue = getQueue(interaction.guildId);

		if (subcommand === 'play') {
			const trackName = interaction.options.getString('track', true);
			if (path.basename(trackName) !== trackName || !supportedExtensions.has(path.extname(trackName).toLowerCase())) {
				await interaction.reply({ content: 'Choose an audio file from the bot\'s `music` folder.', ephemeral: true });
				return;
			}

			const filePath = path.join(musicDirectory, trackName);
			if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
				await interaction.reply({ content: 'That audio file is not in the bot\'s `music` folder.', ephemeral: true });
				return;
			}

			const voiceChannel = getVoiceChannel(interaction);
			if (!voiceChannel) {
				await interaction.reply({ content: 'Join a voice channel before queuing a track.', ephemeral: true });
				return;
			}

			const botMember = interaction.guild.members.me;
			const permissions = botMember && voiceChannel.permissionsFor(botMember);
			if (!permissions?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
				await interaction.reply({ content: 'I need permission to connect to and speak in that voice channel.', ephemeral: true });
				return;
			}

			if (musicQueue && musicQueue.connection.joinConfig.channelId !== voiceChannel.id) {
				await interaction.reply({ content: 'The bot is already playing in another voice channel.', ephemeral: true });
				return;
			}

			if (musicQueue?.queue.length >= maxQueueLength) {
				await interaction.reply({ content: `The queue is limited to ${maxQueueLength} upcoming tracks.`, ephemeral: true });
				return;
			}

			const track = {
				title: path.parse(trackName).name,
				filePath,
			};
			if (!musicQueue) {
				musicQueue = new GuildMusicQueue(interaction.guild, voiceChannel, interaction.channel);
				queues.set(interaction.guildId, musicQueue);
			}
			musicQueue.enqueue(track);

			await interaction.reply(`Queued **${track.title}**. Volume: ${formatVolume(musicQueue.volume)}`);
			return;
		}

		if (!musicQueue) {
			await interaction.reply({ content: 'There is no active music queue.', ephemeral: true });
			return;
		}

		if (subcommand !== 'queue' && !checkQueueControlAccess(interaction, musicQueue)) {
			await interaction.reply({ content: 'Join the bot\'s voice channel to control playback.', ephemeral: true });
			return;
		}

		if (subcommand === 'pause') {
			if (!musicQueue.player.pause()) {
				await interaction.reply({ content: 'There is no track playing to pause.', ephemeral: true });
				return;
			}
			await interaction.reply('Playback paused.');
		}
		else if (subcommand === 'resume') {
			if (!musicQueue.player.unpause()) {
				await interaction.reply({ content: 'Playback is not paused.', ephemeral: true });
				return;
			}
			await interaction.reply('Playback resumed.');
		}
		else if (subcommand === 'skip') {
			if (!musicQueue.currentTrack) {
				await interaction.reply({ content: 'There is no track playing to skip.', ephemeral: true });
				return;
			}
			musicQueue.player.stop(true);
			await interaction.reply('Skipped the current track.');
		}
		else if (subcommand === 'queue') {
			const nowPlaying = musicQueue.currentTrack ? `**Now playing:** ${musicQueue.currentTrack.title}` : '**Nothing is playing.**';
			const upcoming = musicQueue.queue.slice(0, 10)
				.map((track, index) => `${index + 1}. ${track.title}`);
			const remaining = musicQueue.queue.length > upcoming.length
				? `\n...and ${musicQueue.queue.length - upcoming.length} more`
				: '';
			await interaction.reply(`${nowPlaying}\n**Up next:** ${upcoming.length ? `\n${upcoming.join('\n')}` : 'none'}${remaining}`);
		}
		else if (subcommand === 'volume') {
			const volume = interaction.options.getInteger('level', true) / 100;
			musicQueue.setVolume(volume);
			await interaction.reply(`Volume set to ${formatVolume(volume)}`);
		}
		else if (subcommand === 'stop') {
			musicQueue.stop();
			await interaction.reply('Playback stopped and the bot left the voice channel.');
		}
	},
};
