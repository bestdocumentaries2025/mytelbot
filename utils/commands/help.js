import { sendMessage } from "../telegram";

export async function helpCommand(chatId){
    let msg= `The following commands are available:

/start - Start the bot

/help - Get help from the bot

/ping - Ping Pong bot

/cricket - Live Cricket Updates
`
    await sendMessage(chatId,msg)
}