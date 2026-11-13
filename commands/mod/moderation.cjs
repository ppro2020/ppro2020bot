const fs = require('node:fs');
const path = require('node:path');
const {
	ChannelType,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
} = require('discord.js');

const dataDirectory = path.join(__dirname, '..', '..', 'data');
const dataFile = path.join(dataDirectory, 'moderation.json');
const maximumWarningsPerGuild = 10000;

const permissions = {
	ban: PermissionFlagsBits.BanMembers,
	clear: PermissionFlagsBits.ManageMessages,
	kick: PermissionFlagsBits.KickMembers,
	'log-channel': PermissionFlagsBits.ManageGuild,
	lock: PermissionFlagsBits.ManageChannels,
	slowmode: PermissionFlagsBits.ManageChannels,
	timeout: PermissionFlagsBits.ModerateMembers,
	unban: PermissionFlagsBits.BanMembers,
	unlock: PermissionFlagsBits.ManageChannels,
	warn: PermissionFlagsBits.ModerateMembers,
	warnings: PermissionFlagsBits.ModerateMembers,
};

function readData() {
	if (!fs.existsSync(dataFile)) {
		return { guilds: {} };
	}

	const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
	if (!data || typeof data.guilds !== 'object' || Array.isArray(data.guilds)) {
		throw new Error('Moderation data file has an invalid format.');
	}
	return data;
}

function writeData(data) {
	fs.mkdirSync(dataDirectory, { recursive: true });
	const temporaryFile = `${dataFile}.tmp`;
	fs.writeFileSync(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
	fs.renameSync(temporaryFile, dataFile);
}

function getGuildData(data, guildId) {
	if (!data.guilds[guildId]) {
		data.guilds[guildId] = { warnings: [] };
	}
	if (!Array.isArray(data.guilds[guildId].warnings)) {
		throw new Error(`Moderation warning data for guild ${guildId} has an invalid format.`);
	}
	return data.guilds[guildId];
}

function truncate(value, limit = 1024) {
	if (value.length <= limit) {
		return value;
	}
	return `${value.slice(0, limit - 3)}...`;
}

async function replyError(interaction, content) {
	await interaction.reply({ content, ephemeral: true });
}

async function requireBotPermission(interaction, permission) {
	const botMember = interaction.guild.members.me;
	if (botMember?.permissions.has(permission)) {
		return true;
	}

	await replyError(interaction, 'I do not have the Discord permission needed to perform this action.');
	return false;
}

async function resolveTargetMember(interaction, user) {
	const target = await interaction.guild.members.fetch(user.id).catch(error => {
		if (error.code === 10007) {
			return null;
		}
		throw error;
	});

	if (!target) {
		await replyError(interaction, 'That user is not a member of this server.');
		return null;
	}

	const moderator = await interaction.guild.members.fetch(interaction.user.id);
	const botMember = interaction.guild.members.me;
	if (target.id === interaction.guild.ownerId) {
		await replyError(interaction, 'The server owner cannot be moderated.');
		return null;
	}
	if (target.id === interaction.user.id) {
		await replyError(interaction, 'You cannot moderate yourself.');
		return null;
	}
	if (target.id === botMember?.id) {
		await replyError(interaction, 'I cannot moderate myself.');
		return null;
	}
	if (moderator.id !== interaction.guild.ownerId && target.roles.highest.comparePositionTo(moderator.roles.highest) >= 0) {
		await replyError(interaction, 'You cannot moderate a member with an equal or higher role.');
		return null;
	}
	if (botMember && target.roles.highest.comparePositionTo(botMember.roles.highest) >= 0) {
		await replyError(interaction, 'My highest role must be above the target member’s highest role.');
		return null;
	}
	return target;
}

async function logAction(interaction, action, details) {
	const data = readData();
	const guildData = getGuildData(data, interaction.guildId);
	const logChannelId = guildData.logChannelId;
	if (!logChannelId) {
		return false;
	}

	const logChannel = await interaction.guild.channels.fetch(logChannelId);
	const channelPermissions = logChannel?.permissionsFor(interaction.guild.members.me);
	if (!logChannel?.isTextBased()
		|| !channelPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
		throw new Error('The configured moderation log channel is unavailable or I cannot send messages in it.');
	}

	const embed = new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle(`Moderation: ${action}`)
		.addFields(
			{ name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
			{ name: 'Server', value: interaction.guild.name, inline: true },
			...details,
		)
		.setFooter({ text: `Moderator ID: ${interaction.user.id}` })
		.setTimestamp();

	await logChannel.send({ embeds: [embed] });
	return true;
}

async function confirmAction(interaction, action, details, message) {
	let logged = false;
	let logFailed = false;
	try {
		logged = await logAction(interaction, action, details);
	}
	catch (error) {
		logFailed = true;
		console.error(`Moderation action "${action}" succeeded, but its audit log could not be delivered:`, error);
	}
	await interaction.reply({
		content: logged
			? message
			: `${message}\n${logFailed
				? 'The action succeeded, but its audit log could not be delivered. Check the bot console and log-channel permissions.'
				: 'Moderation logs are not configured. Run `/setmodlog` to set them up.'}`,
		ephemeral: true,
	});
}

function targetField(user) {
	return { name: 'Target', value: `${user.tag} (<@${user.id}>)\nID: ${user.id}`, inline: true };
}

function reasonField(reason) {
	return { name: 'Reason', value: truncate(reason || 'No reason provided'), inline: false };
}

function formatDuration(milliseconds) {
	const minutes = Math.floor(milliseconds / 60000);
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	const remainingMinutes = minutes % 60;
	return [days && `${days}d`, hours && `${hours}h`, remainingMinutes && `${remainingMinutes}m`]
		.filter(Boolean)
		.join(' ');
}

function buildUserInfoEmbed(user, member) {
	const roles = member.roles.cache
		.filter(role => role.id !== member.guild.id)
		.sort((first, second) => second.position - first.position)
		.map(role => `<@&${role.id}>`);
	const embed = new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle(`User information: ${user.tag}`)
		.setThumbnail(user.displayAvatarURL({ size: 256 }))
		.addFields(
			{ name: 'User ID', value: user.id, inline: true },
			{ name: 'Discord account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: true },
			{ name: 'Joined this server', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Unknown', inline: true },
			{ name: `Roles (${roles.length})`, value: roles.length ? truncate(roles.join(', '), 1024) : 'No roles', inline: false },
		)
		.setTimestamp();

	if (user.bot) {
		embed.addFields({ name: 'Account type', value: 'Bot', inline: true });
	}
	return embed;
}

function createCommand(name, action, description, configureOptions = builder => builder) {
	return {
		data: configureOptions(new SlashCommandBuilder().setName(name).setDescription(description)),
		execute: interaction => executeModeration(interaction, action),
	};
}

async function executeModeration(interaction, subcommand) {
	if (!interaction.inGuild()) {
		await replyError(interaction, 'Moderation commands are only available in a server.');
		return;
	}

	const requiredPermission = permissions[subcommand];
	if (requiredPermission && !interaction.memberPermissions?.has(requiredPermission)) {
		await replyError(interaction, 'You do not have permission to use this moderation command.');
		return;
	}

	if (subcommand === 'userinfo') {
		const user = interaction.options.getUser('user', true);
		const member = await interaction.guild.members.fetch(user.id).catch(error => {
			if (error.code === 10007) {
				return null;
			}
			throw error;
		});
		if (!member) {
			await replyError(interaction, 'That user is not a member of this server.');
			return;
		}
		await interaction.reply({ embeds: [buildUserInfoEmbed(user, member)] });
		return;
	}

	if (subcommand === 'log-channel') {
		const channel = interaction.options.getChannel('channel', true);
		const channelPermissions = channel.permissionsFor(interaction.guild.members.me);
		if (!channelPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
			await replyError(interaction, 'I need permission to view and send messages in that log channel.');
			return;
		}

		const data = readData();
		getGuildData(data, interaction.guildId).logChannelId = channel.id;
		writeData(data);
		await confirmAction(interaction, 'Set log channel', [
			{ name: 'Log channel', value: `${channel} (${channel.id})`, inline: true },
		], `Moderation logs will be sent to ${channel}.`);
		return;
	}

	if (subcommand === 'warnings') {
		const user = interaction.options.getUser('user', true);
		const guildData = getGuildData(readData(), interaction.guildId);
		const warnings = guildData.warnings.filter(warning => warning.userId === user.id);
		const embed = new EmbedBuilder()
			.setColor(0xf1c40f)
			.setTitle(`Warnings for ${user.tag}`)
			.setDescription(warnings.length
				? warnings.slice(-10).reverse().map((warning, index) => `**${warnings.length - index}.** ${truncate(warning.reason, 700)}\nBy <@${warning.moderatorId}> · <t:${Math.floor(warning.timestamp / 1000)}:R>`).join('\n\n')
				: 'No warnings recorded.')
			.setFooter({ text: `${warnings.length} warning(s) recorded` });
		await interaction.reply({ embeds: [embed], ephemeral: true });
		return;
	}

	if (!await requireBotPermission(interaction, requiredPermission)) {
		return;
	}

	if (subcommand === 'ban' || subcommand === 'kick' || subcommand === 'timeout' || subcommand === 'untimeout' || subcommand === 'warn') {
		const user = interaction.options.getUser('user', true);
		const target = await resolveTargetMember(interaction, user);
		if (!target) {
			return;
		}
		const reason = interaction.options.getString('reason') ?? '';
		if (subcommand === 'ban') {
			await target.ban({ reason: reason || `Banned by ${interaction.user.tag}` });
			await confirmAction(interaction, 'Ban', [targetField(user), reasonField(reason)], `Banned **${user.tag}**.`);
		}
		else if (subcommand === 'kick') {
			await target.kick(reason || `Kicked by ${interaction.user.tag}`);
			await confirmAction(interaction, 'Kick', [targetField(user), reasonField(reason)], `Kicked **${user.tag}**.`);
		}
		else if (subcommand === 'timeout') {
			const minutes = interaction.options.getInteger('minutes', true);
			await target.timeout(minutes * 60000, reason || `Timed out by ${interaction.user.tag}`);
			await confirmAction(interaction, 'Timeout', [
				targetField(user),
				{ name: 'Duration', value: formatDuration(minutes * 60000), inline: true },
				reasonField(reason),
			], `Timed out **${user.tag}** for ${formatDuration(minutes * 60000)}.`);
		}
		else if (subcommand === 'untimeout') {
			await target.timeout(null, reason || `Timeout removed by ${interaction.user.tag}`);
			await confirmAction(interaction, 'Remove timeout', [targetField(user), reasonField(reason)], `Removed timeout for **${user.tag}**.`);
		}
		else {
			const data = readData();
			const guildData = getGuildData(data, interaction.guildId);
			guildData.warnings.push({
				userId: user.id,
				moderatorId: interaction.user.id,
				reason,
				timestamp: Date.now(),
			});
			if (guildData.warnings.length > maximumWarningsPerGuild) {
				guildData.warnings.splice(0, guildData.warnings.length - maximumWarningsPerGuild);
			}
			writeData(data);
			let dmSent = true;
			await user.send(`You were warned in **${interaction.guild.name}**. Reason: ${reason}`).catch(error => {
				if (error.code === 50007) {
					dmSent = false;
					return;
				}
				dmSent = false;
				console.error(`Warning was recorded, but a direct message could not be sent to ${user.tag}:`, error);
			});
			await confirmAction(interaction, 'Warning', [targetField(user), reasonField(reason)], `Warned **${user.tag}** and recorded the warning.${dmSent ? '' : ' Their DMs are closed, so no direct message was sent.'}`);
		}
		return;
	}

	if (subcommand === 'unban') {
		const userId = interaction.options.getString('user-id', true);
		if (!/^\d{17,20}$/.test(userId)) {
			await replyError(interaction, 'Enter a valid Discord user ID.');
			return;
		}
		const reason = interaction.options.getString('reason') ?? '';
		const user = await interaction.client.users.fetch(userId);
		await interaction.guild.bans.remove(userId, reason || `Unbanned by ${interaction.user.tag}`);
		await confirmAction(interaction, 'Unban', [targetField(user), reasonField(reason)], `Unbanned **${user.tag}**.`);
		return;
	}

	if (subcommand === 'clear') {
		if (!interaction.channel.isTextBased() || !interaction.channel.messages?.bulkDelete) {
			await replyError(interaction, 'This command can only be used in a text channel that supports bulk deletion.');
			return;
		}
		const amount = interaction.options.getInteger('amount', true);
		const deleted = await interaction.channel.bulkDelete(amount, true);
		await confirmAction(interaction, 'Clear messages', [
			{ name: 'Channel', value: `${interaction.channel} (${interaction.channel.id})`, inline: true },
			{ name: 'Deleted', value: `${deleted.size} message(s)`, inline: true },
		], `Deleted ${deleted.size} message(s). Messages older than 14 days were skipped.`);
		return;
	}

	if (subcommand === 'slowmode') {
		if (!interaction.channel.isTextBased() || !interaction.channel.setRateLimitPerUser) {
			await replyError(interaction, 'Slowmode can only be changed in a supported text channel.');
			return;
		}
		const seconds = interaction.options.getInteger('seconds', true);
		const reason = interaction.options.getString('reason') ?? '';
		await interaction.channel.setRateLimitPerUser(seconds, reason || `Changed by ${interaction.user.tag}`);
		await confirmAction(interaction, 'Slowmode', [
			{ name: 'Channel', value: `${interaction.channel} (${interaction.channel.id})`, inline: true },
			{ name: 'Delay', value: `${seconds} second(s)`, inline: true },
			reasonField(reason),
		], `Set channel slowmode to ${seconds} second(s).`);
		return;
	}

	if (subcommand === 'lock' || subcommand === 'unlock') {
		if (!interaction.channel.isTextBased() || !interaction.channel.permissionOverwrites) {
			await replyError(interaction, 'This command can only be used in a supported text channel.');
			return;
		}
		const reason = interaction.options.getString('reason') ?? '';
		const sendPermission = subcommand === 'lock' ? false : null;
		await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
			SendMessages: sendPermission,
			SendMessagesInThreads: sendPermission,
		}, { reason: reason || `Channel ${subcommand}ed by ${interaction.user.tag}` });
		await confirmAction(interaction, subcommand === 'lock' ? 'Lock channel' : 'Unlock channel', [
			{ name: 'Channel', value: `${interaction.channel} (${interaction.channel.id})`, inline: true },
			reasonField(reason),
		], `Channel ${subcommand}ed.`);
	}
}

module.exports = {
	commands: [
		createCommand('ban', 'ban', 'Ban a member from the server', builder => builder
			.addUserOption(option => option.setName('user').setDescription('Member to ban').setRequired(true))
			.addStringOption(option => option.setName('reason').setDescription('Reason for the ban').setMaxLength(1000))),
		createCommand('unban', 'unban', 'Unban a user by ID', builder => builder
			.addStringOption(option => option.setName('user-id').setDescription('Discord user ID').setRequired(true).setMinLength(17).setMaxLength(20))
			.addStringOption(option => option.setName('reason').setDescription('Reason for the unban').setMaxLength(1000))),
		createCommand('kick', 'kick', 'Remove a member from the server', builder => builder
			.addUserOption(option => option.setName('user').setDescription('Member to kick').setRequired(true))
			.addStringOption(option => option.setName('reason').setDescription('Reason for the kick').setMaxLength(1000))),
		createCommand('timeout', 'timeout', 'Timeout a member', builder => builder
			.addUserOption(option => option.setName('user').setDescription('Member to timeout').setRequired(true))
			.addIntegerOption(option => option.setName('minutes').setDescription('Timeout duration in minutes (1-40320)').setRequired(true).setMinValue(1).setMaxValue(40320))
			.addStringOption(option => option.setName('reason').setDescription('Reason for the timeout').setMaxLength(1000))),
		createCommand('untimeout', 'untimeout', 'Remove a member timeout', builder => builder
			.addUserOption(option => option.setName('user').setDescription('Member to untimeout').setRequired(true))
			.addStringOption(option => option.setName('reason').setDescription('Reason for removing the timeout').setMaxLength(1000))),
		createCommand('warn', 'warn', 'Warn a member and record the warning', builder => builder
			.addUserOption(option => option.setName('user').setDescription('Member to warn').setRequired(true))
			.addStringOption(option => option.setName('reason').setDescription('Reason for the warning').setRequired(true).setMaxLength(1000))),
		createCommand('warnings', 'warnings', 'Show recorded warnings for a member', builder => builder
			.addUserOption(option => option.setName('user').setDescription('Member whose warnings to show').setRequired(true))),
		createCommand('clear', 'clear', 'Delete recent messages from this channel', builder => builder
			.addIntegerOption(option => option.setName('amount').setDescription('Number of recent messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))),
		createCommand('slowmode', 'slowmode', 'Set this channel’s slowmode', builder => builder
			.addIntegerOption(option => option.setName('seconds').setDescription('Delay in seconds (0-21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
			.addStringOption(option => option.setName('reason').setDescription('Reason for changing slowmode').setMaxLength(1000))),
		createCommand('lock', 'lock', 'Prevent members from sending messages in this channel', builder => builder
			.addStringOption(option => option.setName('reason').setDescription('Reason for locking the channel').setMaxLength(1000))),
		createCommand('unlock', 'unlock', 'Allow members to send messages in this channel', builder => builder
			.addStringOption(option => option.setName('reason').setDescription('Reason for unlocking the channel').setMaxLength(1000))),
		createCommand('setmodlog', 'log-channel', 'Set the channel for moderation logs', builder => builder
			.addChannelOption(option => option
				.setName('channel')
				.setDescription('Text channel for moderation logs')
				.setRequired(true)
				.addChannelTypes(ChannelType.GuildText))),
		createCommand('userinfo', 'userinfo', 'Show a member’s ID, join dates, and roles', builder => builder
			.addUserOption(option => option.setName('user').setDescription('Member to inspect').setRequired(true))),
	],
};
