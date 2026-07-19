/**
 * 轻量结构化日志器
 *
 * 零依赖的 JSON Lines 日志实现，供插件各模块统一使用：
 * - 全部输出到 stderr，避免污染 MCP stdio 通信通道（stdout）
 * - 日志级别通过环境变量 ZETTELKASTEN_LOG_LEVEL 控制
 *   （debug / info / warn / error / silent，默认 info）
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

const VALID_LEVELS: ReadonlySet<string> = new Set([
  "debug",
  "info",
  "warn",
  "error",
  "silent",
]);

function resolveEnvLevel(): LogLevel {
  const raw = process.env.ZETTELKASTEN_LOG_LEVEL?.trim().toLowerCase();
  return raw && VALID_LEVELS.has(raw) ? (raw as LogLevel) : "info";
}

let currentLevel: LogLevel = resolveEnvLevel();

/**
 * 设置全局日志级别（优先级高于环境变量）
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * 获取当前全局日志级别
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

function write(
  level: LogLevel,
  component: string,
  message: string,
  context?: LogContext
): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    component,
    msg: message,
  };
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      entry[key] = serializeValue(value);
    }
  }

  // 始终写 stderr：stdout 保留给 MCP stdio 协议帧
  console.error(JSON.stringify(entry));
}

/**
 * 创建绑定组件名的日志器
 *
 * @param component 组件标识（通常为类名或模块名），会写入每条日志的 component 字段
 */
export function createLogger(component: string): Logger {
  return {
    debug: (message, context) => write("debug", component, message, context),
    info: (message, context) => write("info", component, message, context),
    warn: (message, context) => write("warn", component, message, context),
    error: (message, context) => write("error", component, message, context),
  };
}
