import {
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import * as fs from "fs";
import * as path from "path";
import { Session } from "./db";
import { generateCodeUpdate, ExecuteCommand } from "./ai";
import { getWorkspaceContext, executeShellCommand } from "./utils";

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
  executedCommands?: ExecuteCommand[];
  resultDesc?: string;
  abortController?: AbortController;
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
   * 현재 채널의 대기열 작업을 즉시 강제 종료하고 대기열을 비웁니다.
   */
  public forceStop(channelId: string): {
    success: boolean;
    runningCancelled: boolean;
    cancelledCount: number;
    runningRequest?: string;
  } {
    const queue = this.queues.get(channelId);
    if (!queue || queue.length === 0) {
      return { success: false, runningCancelled: false, cancelledCount: 0 };
    }

    const runningItem = queue.find((item) => item.status === "processing");
    const cancelledCount = queue.filter((item) => item.status === "waiting").length;

    let runningCancelled = false;
    let runningRequest: string | undefined;

    if (runningItem) {
      runningCancelled = true;
      runningRequest = runningItem.userRequest;
      // LLM 호출 및 쉘 명령어 실행 Abort
      runningItem.abortController?.abort();

      // 실행 중이던 아이템에 강제 종료 상태 표시
      runningItem.status = "error";
      runningItem.completedAt = Date.now();
      runningItem.errorMessage = "사용자에 의해 강제 종료되었습니다.";
    }

    // 대기열 비우기 (splice를 통해 기존 배열 참조를 비워서 루프가 즉시 종료되도록 처리)
    queue.splice(0, queue.length);
    this.processing.set(channelId, false);
    this.stopLiveUpdate(channelId);

    return {
      success: true,
      runningCancelled,
      cancelledCount,
      runningRequest,
    };
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
    const controller = new AbortController();
    item.abortController = controller;

    try {
      // 1단계(및 setupCommands 자동 실행)와 2단계를 일괄 수행합니다.
      const result = await generateCodeUpdate(
        item.session.spec_summary,
        item.session.project_path,
        item.userRequest,
        item.localModelOpt,
        controller.signal,
      );

      const executedCommands: ExecuteCommand[] = [];

      // 1단계 사전 실행 명령어 기록
      if (result.setupCommands && result.setupCommands.length > 0) {
        for (const cmd of result.setupCommands) {
          executedCommands.push({ cmd, desc: "사전 설정 명령어" });
        }
      }

      // 2단계 실행 명령어를 /bin/bash 환경에서 순차 실행
      if (result.execute && result.execute.length > 0) {
        console.log(`[Queue Task] Running ${result.execute.length} execution commands...`);
        for (const execObj of result.execute) {
          if (controller.signal.aborted) {
            throw new Error("사용자에 의해 강제 종료되었습니다.");
          }
          console.log(`[Queue Task] Executing bash command: ${execObj.cmd}`);
          await executeShellCommand(execObj.cmd, item.session.project_path, controller.signal);
          executedCommands.push(execObj);
        }
      }

      item.status = "done";
      item.completedAt = Date.now();
      item.executedCommands = executedCommands;
      item.resultDesc = result.desc;
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

        const fields = [];

        if (item.executedCommands && item.executedCommands.length > 0) {
          const cmdListStr = item.executedCommands
            .map((c) => `\`${c.cmd}\` ${c.desc ? `(${c.desc})` : ""}`)
            .join("\n");
          fields.push({
            name: "💻 실행된 명령어",
            value: cmdListStr.length > 1024 ? cmdListStr.substring(0, 1000) + "\n... (생략됨)" : cmdListStr,
            inline: false,
          });
        }

        fields.push({
          name: "⏱️ 소요 시간",
          value: this.formatElapsed(totalTime),
          inline: true,
        });

        // 결과 요약 설명 자연어로 최종 보고
        const descriptionText = item.resultDesc
          ? `${item.resultDesc}`
          : `**요청:** ${item.userRequest}\n\n작업이 성공적으로 수행되었습니다.`;

        embed
          .setTitle("✅ 작업 완료!")
          .setDescription(descriptionText)
          .setColor(0x2ecc71) // 초록색
          .addFields(fields)
          .setFooter({
            text: `작업 ID: #${item.id} · /적용 으로 GitHub에 반영`,
          })
          .setTimestamp();
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
