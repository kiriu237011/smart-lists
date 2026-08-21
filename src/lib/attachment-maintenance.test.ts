import { describe, expect, it } from "vitest";

import { parseAttachmentMaintenanceRow } from "@/lib/attachment-maintenance";

describe("parseAttachmentMaintenanceRow", () => {
  it("принимает минимальный payload helper", () => {
    expect(
      parseAttachmentMaintenanceRow({
        cleanupPayload: [
          {
            token: "ea650a40-eefa-4e4c-a4a4-6b3f0b3eb747",
            key: "lists/list-1/file.png",
          },
        ],
        userCount: 3n,
      }),
    ).toEqual({
      cleanupItems: [
        {
          token: "ea650a40-eefa-4e4c-a4a4-6b3f0b3eb747",
          key: "lists/list-1/file.png",
        },
      ],
      userCount: 3,
    });
  });

  it("fail-closed отклоняет произвольный токен или key", () => {
    expect(() =>
      parseAttachmentMaintenanceRow({
        cleanupPayload: [{ token: "not-a-token", key: "" }],
        userCount: 0n,
      }),
    ).toThrow("Некорректный cleanup payload");
  });
});
