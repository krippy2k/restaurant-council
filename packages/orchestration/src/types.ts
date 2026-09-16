import type { AgentRuntime } from "@rc/agents";
import type { PersonalAgentPrincipal, Principal } from "@rc/auth";
import type {
  Event,
  EventMember,
  Preference,
  PrivatePreferenceRecord,
  User
} from "@rc/domain";
import type { CouncilClientEvent, CouncilConstraint, CouncilProgress, CouncilSnapshot } from "@rc/protocol";
import type { RestaurantSearchTool, DietaryAnalyzer } from "@rc/tools";

export interface CouncilRunInput {
  eventId: string;
}

export interface CouncilDependencies {
  getEvent(eventId: string): Promise<Event>;
  listMembers(eventId: string): Promise<EventMember[]>;
  getUser(userId: string): Promise<User>;
  listPublicPreferences(eventId: string): Promise<Preference[]>;
  readVaultForAgent(
    principal: PersonalAgentPrincipal,
    userId: string,
    eventId: string
  ): Promise<PrivatePreferenceRecord[]>;
  saveConstraints(constraints: CouncilConstraint[]): Promise<void>;
  restaurants: RestaurantSearchTool;
  dietary?: DietaryAnalyzer;
  runtime?: AgentRuntime;
  emit(event: CouncilClientEvent, snapshot: CouncilSnapshot): Promise<void>;
  persist(snapshot: CouncilSnapshot): Promise<void>;
  reportProgress?(progress: CouncilProgress, snapshot: CouncilSnapshot): Promise<void>;
  audit(input: {
    principal: Principal;
    action: string;
    resource?: string;
    decision: string;
    reason?: string;
    eventId?: string;
  }): Promise<void>;
}
