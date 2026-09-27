// Shapes shared by the offer page (server) and the offer editor (client).
// Kept in a plain module — not a "use client" file — so the server page can
// build the editor's initial state with these helpers.

export interface EditorMachine {
  id: string;
  name: string;
  costPerMinute: number;
  active: boolean;
}

export interface EditorMaterial {
  id: string;
  name: string;
  unit: string;
  unitCost: number;
  active: boolean;
}

export interface EditorCosting {
  machineId: string;
  machineMinutes: string;
  labourHours: string;
  setupHours: string;
  materials: { key: number; materialId: string; quantity: string }[];
}

export interface EditorLine {
  key: number;
  description: string;
  quantity: string;
  price: string; // in the current entry mode (excl. or incl. VAT)
  vatRate: string;
  costingOpen: boolean;
  costing: EditorCosting;
}

export interface EditorInitial {
  pricesIncludeVat: boolean;
  validUntil: string; // yyyy-mm-dd or ""
  intro: string;
  terms: string;
  lines: EditorLine[];
}

export const emptyCosting = (): EditorCosting => ({
  machineId: "",
  machineMinutes: "",
  labourHours: "",
  setupHours: "",
  materials: [{ key: 1, materialId: "", quantity: "" }],
});
