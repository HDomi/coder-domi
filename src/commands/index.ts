import { logs } from "./logs";
import { uptime } from "./uptime";
import { clearChat } from "./clearChat";
import { posting } from "./posting";
import { autoPosting } from "./autoPosting";
import { deletePost } from "./deletePost";
import { stopPosting } from "./stopPosting";
import { fortuneSetChannel } from "./fortuneSetChannel";
import { fortuneSetInfo } from "./fortuneSetInfo";
import { fortuneGet } from "./fortuneGet";
import { todayFortune } from "./todayFortune";
import { fortuneSearch } from "./fortuneSearch";
import { Command } from "../types";

export const commands: Command[] = [
  logs,
  uptime,
  clearChat,
  posting,
  autoPosting,
  deletePost,
  stopPosting,
  fortuneSetChannel,
  fortuneSetInfo,
  fortuneGet,
  todayFortune,
  fortuneSearch,
];
