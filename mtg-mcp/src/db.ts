import neo4j, { Driver, ManagedTransaction, Session } from "neo4j-driver";
import { config } from "./config.js";

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      config.NEO4J_URI,
      neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD)
    );
  }
  return driver;
}

export async function withReadSession<T>(
  work: (tx: ManagedTransaction) => Promise<T>
): Promise<T> {
  const session: Session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    return await session.executeRead(work);
  } finally {
    await session.close();
  }
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
