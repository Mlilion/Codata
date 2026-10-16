import { RemoteTabContent } from "./content";

export default function RemotePage() {
  return (
    <div className="flex-1 overflow-y-auto bg-[var(--surface-chat)] scrollbar-auto">
      <RemoteTabContent />
    </div>
  );
}
