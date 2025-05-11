const fs = require('Node:fs');
const path = require('node:path');
const { Client, Events, Collection, GatewayIntentBits, ActivityType, PresenceUpdateStatus } = require('discord.js');
const { token } = require('./config.json')

// new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for ( const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for ( const filz of commandFiles) {
        const filePath = path.join((commandsPath), file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING ] The command at ${filePath} is missing a required "data" or "execute" property`);
        }
    }
}


client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`)
    client.user.setStatus(PresenceUpdateStatus.DoNotDisturb);
    client.user.setActivity('You', { type: ActivityType.Watching});
});



client.login(token);
