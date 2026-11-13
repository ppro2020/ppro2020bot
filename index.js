const fs = require('fs');
const path = require('node:path');
const { Client, Events, Collection, GatewayIntentBits, ActivityType, PresenceUpdateStatus, MessageFlags } = require('discord.js');
const { token } = require('./config.json')

// new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for ( const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for ( const file of commandFiles) {
        const filePath = path.join((commandsPath), file);
        const command = require(filePath);

        const commandList = Array.isArray(command.commands) ? command.commands : [command];
        for (const commandItem of commandList) {
            if ('data' in commandItem && 'execute' in commandItem) {
                client.commands.set(commandItem.data.name, commandItem);
            } else {
                console.log(`[WARNING ] The command at ${filePath} is missing a required "data" or "execute" property`);
            }
        }
    }
}

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command?.autocomplete) {
            await interaction.respond([]);
            return;
        }

        try {
            await command.autocomplete(interaction);
        } catch (error) {
            console.error(error);
            await interaction.respond([]);
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    
    const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
        console.error(`No command matching ${interaction.commandName} was found `);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({content: 'there was an error while executing this command', flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({content: 'there was an error while executing this command', flags: MessageFlags.Ephemeral});
        }
    
    }
});


client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`)
    client.user.setStatus(PresenceUpdateStatus.DoNotDisturb);
    client.user.setActivity('You', { type: ActivityType.Watching});
});



client.login(token);
