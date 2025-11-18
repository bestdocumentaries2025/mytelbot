import { sendMessage } from "../telegram";

export async function pingCommand(chatId){
    await sendMessage(chatId,"pong")
}