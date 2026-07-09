import {
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import * as fs from "fs";
import * as path from "path";
import { Session } from "./db";
import { generateCodeUpdate } from "./ai";
import { getWorkspaceContext } from "./utils";

// ─── 큐 아이템 상태 정의 ───
type QueueItemStatus = "waiting" | "processing" | "done" | "error";

export interface QueueItem {
  id: number;
  channelId: string;
  userRequest: string;
  localModelOpt?: boolean;
  session: Session;
  interaction: ChatInputCommandInteraction;
  status: QueueItemStatus;
  enqueuedAt: number;     // Date.now()
  startedAt?: number;
  completedAt?: number;
  resultFiles?: string[];
  errorMessage?: string;
}

// ─── 싱글톤 큐 매니저 ───
class QueueManager {
  // 채널별 대기열
  private queues = new Map<string, QueueItem[]>();
  // 채널별 실행 중 플래그
  private processing = new Map<string, boolean>();
  // 글로벌 ID 카운터
  private idCounter = 0;
  // 채널별 실시간 업데이트 타이머
  private liveTimers = new Map<string, NodeJS.Timeout>();

  /**
   * 새 코딩 작업을 큐에 추가하고 즉시 대기열 Embed 메시지를 응답합니다.
   */
  async enqueue(
    channelId: string,
    userRequest: string,
    localModelOpt: boolean | undefined,
    session: Session,
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const item: QueueItem = {
      id: ++this.idCounter,
      channelId,
      userRequest,
      localModelOpt: localModelOpt !== null ? localModelOpt : undefined,
      session,
      interaction,
      status: "waiting",
      enqueuedAt: Date.now(),
    };

    if (!this.queues.has(channelId)) {
      this.queues.set(channelId, []);
    }
    this.queues.get(channelId)!.push(item);

    // 즉시 대기열 상태 Embed으로 응답 (타임아웃 방지)
    const embed = this.buildItemEmbed(item, this.queues.get(channelId)!);
    await interaction.reply({ embeds: [embed] });

    // 큐 프로세서 가동 (이미 돌고 있으면 무시)
    this.processQueue(channelId);
  }

  /**
   * 채널별로 하나의 작업만 순차적으로 실행합니다.
   */
  private async processQueue(channelId: string): Promise<void> {
    if (this.processing.get(channelId)) return;
    this.processing.set(channelId, true);

    const queue = this.queues.get(channelId);
    if (!queue) {
      this.processing.set(channelId, false);
      return;
    }

    while (queue.length > 0) {
      const item = queue[0];
      item.status = "processing";
      item.startedAt = Date.now();

      // 현재 진행 중인 작업의 Embed을 즉시 업데이트
      await this.updateItemEmbed(item, queue);

      // 실시간 경과 시간 타이머 시작 (3초 간격)
      this.startLiveUpdate(channelId, item, queue);

      // 실제 작업 실행
      await this.executeTask(item);

      // 실시간 타이머 정지
      this.stopLiveUpdate(channelId);

      // 큐에서 제거
      queue.shift();

      // 완료/실패 후 최종 결과로 Embed 업데이트
      await this.updateItemEmbed(item, queue);

      // 대기열에 남아있는 항목들의 순서 업데이트
      for (const waitingItem of queue) {
        await this.updateItemEmbed(waitingItem, queue);
      }
    }

    this.processing.set(channelId, false);
  }

  /**
   * 실제 AI 코드 생성 및 파일 쓰기를 수행합니다.
   */
  private async executeTask(item: QueueItem): Promise<void> {
    try {
      const workspaceContext = getWorkspaceContext(item.session.project_path);

      const changes = await generateCodeUpdate(
        item.session.spec_summary,
        workspaceContext,
        item.userRequest,
        item.localModelOpt,
      );

      if (changes.length === 0) {
        item.status = "done";
        item.completedAt = Date.now();
        item.resultFiles = [];
        return;
      }

      const updatedFiles: string[] = [];

      for (const change of changes) {
        const targetPath = path.resolve(item.session.project_path, change.path);

        // 경로 이탈 보안 방지
        if (!targetPath.startsWith(item.session.project_path)) {
          console.warn(
            `[Security Warning] Blocked file write attempt outside workspace: ${change.path}`,
          );
          continue;
        }

        const dirPath = path.dirname(targetPath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }

        fs.writeFileSync(targetPath, change.content, "utf-8");
        updatedFiles.push(change.path);
      }

      item.status = "done";
      item.completedAt = Date.now();
      item.resultFiles = updatedFiles;
    } catch (error: any) {
      console.error("❌ [Queue Task Error]", error);
      item.status = "error";
      item.completedAt = Date.now();
      item.errorMessage = error.message;
    }
  }

  /**
   * 3초마다 진행 중인 작업의 경과 시간을 갱신합니다.
   */
  private startLiveUpdate(
    channelId: string,
    item: QueueItem,
    queue: QueueItem[],
  ): void {
    this.stopLiveUpdate(channelId);
    const timer = setInterval(async () => {
      if (item.status !== "processing") {
        this.stopLiveUpdate(channelId);
        return;
      }
      try {
        await this.updateItemEmbed(item, queue);
      } catch (e) {
        // interaction이 만료된 경우 무시
        console.warn("[Live Update] Embed 업데이트 실패 (무시됨):", e);
      }
    }, 3000);
    this.liveTimers.set(channelId, timer);
  }

  private stopLiveUpdate(channelId: string): void {
    const timer = this.liveTimers.get(channelId);
    if (timer) {
      clearInterval(timer);
      this.liveTimers.delete(channelId);
    }
  }

  /**
   * 개별 아이템의 interaction 메시지를 최신 Embed으로 업데이트합니다.
   */
  private async updateItemEmbed(
    item: QueueItem,
    queue: QueueItem[],
  ): Promise<void> {
    try {
      const embed = this.buildItemEmbed(item, queue);
      await item.interaction.editReply({ embeds: [embed] });
    } catch (e) {
      // interaction이 이미 만료/삭제된 경우 무시
    }
  }

  /**
   * 큐 아이템의 상태에 따라 적절한 Embed 메시지를 구성합니다.
   */
  private buildItemEmbed(item: QueueItem, queue: QueueItem[]): EmbedBuilder {
    const embed = new EmbedBuilder();

    switch (item.status) {
      case "waiting": {
        const position =
          queue.filter((q) => q.status === "waiting").indexOf(item) + 1;
        const totalWaiting = queue.filter(
          (q) => q.status === "waiting",
        ).length;

        embed
          .setTitle("⏳ 대기열에 추가됨")
          .setDescription(`**요청:** ${item.userRequest}`)
          .setColor(0xffa500) // 주황색
          .addFields(
            {
              name: "📋 대기열 순서",
              value: `${position}/${totalWaiting}`,
              inline: true,
            },
            {
              name: "⏱️ 대기 시간",
              value: this.formatElapsed(Date.now() - item.enqueuedAt),
              inline: true,
            },
          )
          .setFooter({ text: `작업 ID: #${item.id}` })
          .setTimestamp(item.enqueuedAt);
        break;
      }

      case "processing": {
        const elapsed = Date.now() - (item.startedAt || Date.now());
        const waitingCount = queue.filter(
          (q) => q.status === "waiting",
        ).length;

        embed
          .setTitle("🔄 코더도미 작업 중...")
          .setDescription(`**요청:** ${item.userRequest}`)
          .setColor(0x3498db) // 파란색
          .addFields(
            {
              name: "⏱️ 경과 시간",
              value: this.formatElapsed(elapsed),
              inline: true,
            },
            {
              name: "📋 대기 중인 작업",
              value: `${waitingCount}개`,
              inline: true,
            },
          )
          .setFooter({ text: `작업 ID: #${item.id}` })
          .setTimestamp();
        break;
      }

      case "done": {
        const totalTime =
          (item.completedAt || Date.now()) - (item.startedAt || item.enqueuedAt);

        if (item.resultFiles && item.resultFiles.length > 0) {
          const fileListStr = item.resultFiles
            .map((f) => `\`${f}\``)
            .join("\n");
          embed
            .setTitle("✅ 코드 자동 인젝션 완료!")
            .setDescription(`**요청:** ${item.userRequest}`)
            .setColor(0x2ecc71) // 초록색
            .addFields(
              {
                name: "📂 수정된 파일",
                value: fileListStr,
                inline: false,
              },
              {
                name: "⏱️ 소요 시간",
                value: this.formatElapsed(totalTime),
                inline: true,
              },
            )
            .setFooter({
              text: `작업 ID: #${item.id} · /적용 으로 GitHub에 반영`,
            })
            .setTimestamp();
        } else {
          embed
            .setTitle("ℹ️ 변경 사항 없음")
            .setDescription(
              `**요청:** ${item.userRequest}\n\nAI 분석 결과, 변경해야 할 파일이 없습니다.`,
            )
            .setColor(0x95a5a6) // 회색
            .addFields({
              name: "⏱️ 소요 시간",
              value: this.formatElapsed(totalTime),
              inline: true,
            })
            .setFooter({ text: `작업 ID: #${item.id}` })
            .setTimestamp();
        }
        break;
      }

      case "error": {
        const totalTime =
          (item.completedAt || Date.now()) - (item.startedAt || item.enqueuedAt);
        let errMsg = item.errorMessage || "알 수 없는 오류";
        if (errMsg.length > 1000) {
          errMsg = errMsg.substring(0, 950) + "\n... (오류 메시지 생략됨)";
        }

        embed
          .setTitle("❌ 작업 실패")
          .setDescription(`**요청:** ${item.userRequest}`)
          .setColor(0xe74c3c) // 빨간색
          .addFields(
            {
              name: "🔍 오류 내용",
              value: errMsg,
              inline: false,
            },
            {
              name: "⏱️ 소요 시간",
              value: this.formatElapsed(totalTime),
              inline: true,
            },
          )
          .setFooter({ text: `작업 ID: #${item.id}` })
          .setTimestamp();
        break;
      }
    }

    return embed;
  }

  /**
   * 밀리초를 사람이 읽기 좋은 형태로 변환합니다.
   */
  private formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}초`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}분 ${seconds}초`;
    const hours = Math.floor(minutes / 60);
    const remainMinutes = minutes % 60;
    return `${hours}시간 ${remainMinutes}분 ${seconds}초`;
  }
}

// 싱글톤 인스턴스 내보내기
export const queueManager = new QueueManager();
