import type { HelloagentsApi } from "../../shared/api";

declare global {
  interface Window {
    helloagents: HelloagentsApi;
  }
}
