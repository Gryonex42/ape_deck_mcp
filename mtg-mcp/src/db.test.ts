import { describe, it, expect, afterAll } from "vitest";
import { getDriver, withReadSession, closeDriver } from "./db.js";

afterAll(async () => {
  await closeDriver();
});

describe("Neo4j connection", () => {
  it("connects and verifies connectivity", async () => {
    const driver = getDriver();
    const serverInfo = await driver.getServerInfo();
    expect(serverInfo).toBeDefined();
  });

  it("counts Card nodes via withReadSession", async () => {
    const result = await withReadSession(async (tx) => {
      const res = await tx.run("MATCH (c:Card) RETURN count(c) AS count");
      return res.records[0].get("count").toNumber();
    });

    expect(result).toBeGreaterThan(0);
    console.error(`Smoke test: found ${result} Card nodes`);
  });

  it("can read a sample card", async () => {
    const result = await withReadSession(async (tx) => {
      const res = await tx.run(
        "MATCH (c:Card) RETURN c.name AS name LIMIT 1"
      );
      return res.records[0].get("name") as string;
    });

    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
    console.error(`Smoke test: sample card name = "${result}"`);
  });
});
