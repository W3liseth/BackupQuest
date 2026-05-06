import type { AppConfig } from "./types";

const hours = Array.from({ length: 24 }, (_, hour) => ({
  label: String(hour).padStart(2, "0"),
  value: hour,
}));

const minutes = Array.from({ length: 60 }, (_, minute) => ({
  label: String(minute).padStart(2, "0"),
  value: minute,
}));

const weekDays = [
  { label: "Lun", value: 1 },
  { label: "Mar", value: 2 },
  { label: "Mer", value: 3 },
  { label: "Jeu", value: 4 },
  { label: "Ven", value: 5 },
  { label: "Sam", value: 6 },
  { label: "Dim", value: 0 },
];

type ScheduleMode = "daily" | "weekly";

export function AutoBackupSettings({
  config,
  onSetCronEnabled,
  onSetCronExpression,
}: {
  config: AppConfig;
  onSetCronEnabled: (enabled: boolean) => void;
  onSetCronExpression: (value: string) => void;
}) {
  const schedule = parseSchedule(config.cronExpression);

  const setMode = (mode: ScheduleMode) => {
    if (mode === "daily") {
      onSetCronExpression(toDailyCron(schedule.hour, schedule.minute));
      return;
    }

    onSetCronExpression(
      toWeeklyCron(schedule.hour, schedule.minute, schedule.days.length > 0 ? schedule.days : [1]),
    );
  };

  const setHour = (hour: number) => {
    if (schedule.mode === "daily") {
      onSetCronExpression(toDailyCron(hour, schedule.minute));
      return;
    }
    onSetCronExpression(
      toWeeklyCron(hour, schedule.minute, schedule.days.length > 0 ? schedule.days : [1]),
    );
  };

  const setMinute = (minute: number) => {
    if (schedule.mode === "daily") {
      onSetCronExpression(toDailyCron(schedule.hour, minute));
      return;
    }
    onSetCronExpression(
      toWeeklyCron(schedule.hour, minute, schedule.days.length > 0 ? schedule.days : [1]),
    );
  };

  const toggleDay = (day: number) => {
    const currentDays = schedule.days.length > 0 ? schedule.days : [1];
    const nextDays = currentDays.includes(day)
      ? currentDays.filter((selectedDay) => selectedDay !== day)
      : [...currentDays, day];

    onSetCronExpression(toWeeklyCron(schedule.hour, schedule.minute, nextDays.length > 0 ? nextDays : [day]));
  };

  return (
    <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sauvegarde automatique</h2>
          <p className="mt-1 text-sm text-[#a3a3a3]">
            Planifie les backups lorsque BackupQuest est ouvert.
          </p>
        </div>
        <button
          className={`relative h-7 w-12 rounded-full transition ${
            config.cronEnabled ? "bg-[#ffffff]" : "bg-[#3a3a3a]"
          }`}
          type="button"
          onClick={() => onSetCronEnabled(!config.cronEnabled)}
        >
          <span
            className={`absolute top-1 size-5 rounded-full bg-[#111111] shadow transition ${
              config.cronEnabled ? "left-6" : "left-1"
            }`}
          />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-[#050505] p-1">
        <button
          className={`h-9 rounded-md text-sm font-medium transition ${
            schedule.mode === "daily"
              ? "bg-[#ffffff] text-[#030303] shadow-sm"
              : "text-[#a3a3a3] hover:bg-[#1f1f1f]"
          }`}
          type="button"
          onClick={() => setMode("daily")}
        >
          Journalier
        </button>
        <button
          className={`h-9 rounded-md text-sm font-medium transition ${
            schedule.mode === "weekly"
              ? "bg-[#ffffff] text-[#030303] shadow-sm"
              : "text-[#a3a3a3] hover:bg-[#1f1f1f]"
          }`}
          type="button"
          onClick={() => setMode("weekly")}
        >
          Hebdomadaire
        </button>
      </div>

      {schedule.mode === "weekly" && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a3a3a3]">
            Jours
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {weekDays.map((day) => {
              const active = schedule.days.includes(day.value);
              return (
                <button
                  key={day.value}
                  className={`h-9 rounded-md border text-sm font-medium transition ${
                    active
                      ? "border-[#ffffff] bg-[#ffffff] text-[#030303]"
                      : "border-[#2f2f2f] bg-[#111111] text-[#a3a3a3] hover:bg-[#1f1f1f]"
                  }`}
                  type="button"
                  onClick={() => toggleDay(day.value)}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a3a3a3]">
            Heure
          </span>
          <select
            className="mt-2 h-10 w-full rounded-md border border-[#3a3a3a] bg-[#111111] px-3 text-sm outline-none focus:border-[#ffffff] focus:ring-3 focus:ring-[#ffffff]/25"
            value={schedule.hour}
            onChange={(event) => setHour(Number(event.target.value))}
          >
            {hours.map((hour) => (
              <option key={hour.value} value={hour.value}>
                {hour.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a3a3a3]">
            Minutes
          </span>
          <select
            className="mt-2 h-10 w-full rounded-md border border-[#3a3a3a] bg-[#111111] px-3 text-sm outline-none focus:border-[#ffffff] focus:ring-3 focus:ring-[#ffffff]/25"
            value={schedule.minute}
            onChange={(event) => setMinute(Number(event.target.value))}
          >
            {minutes.map((minute) => (
              <option key={minute.value} value={minute.value}>
                {minute.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function parseSchedule(expression: string) {
  const fields = expression.trim().split(/\s+/);
  const minute = parseMinute(fields[0]);
  const hour = parseHour(fields[1]);
  const dayOfWeek = fields[4] ?? "*";

  if (dayOfWeek === "*") {
    return { mode: "daily" as const, hour, minute, days: [] };
  }

  const days = dayOfWeek
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

  return { mode: "weekly" as const, hour, minute, days: days.length > 0 ? days : [1] };
}

function parseMinute(value: string | undefined) {
  const minute = Number(value);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return 0;
  }
  return minute;
}

function parseHour(value: string | undefined) {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return 20;
  }
  return hour;
}

function toDailyCron(hour: number, minute: number) {
  return `${minute} ${hour} * * *`;
}

function toWeeklyCron(hour: number, minute: number, days: number[]) {
  const normalizedDays = [...new Set(days)]
    .filter((day) => day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  return `${minute} ${hour} * * ${normalizedDays.join(",") || "1"}`;
}
