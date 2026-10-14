export type VehicleKind = 'car' | 'pickup' | 'van' | 'bus' | 'hgv' | 'design';

export interface VehicleType {
  id: VehicleKind;
  name: string;
  /** gross mass kg */
  mass: number;
  length: number;
  height: number;
  wheelR: number;
  /** axle positions measured from the rear bumper (m) and share of gross weight */
  axles: { x: number; share: number }[];
  /** cruising speed m/s */
  speed: number;
  color: string;
}

export const VEHICLES: Record<VehicleKind, VehicleType> = {
  car: {
    id: 'car', name: 'Car', mass: 1500, length: 4.4, height: 1.45, wheelR: 0.33,
    axles: [{ x: 0.85, share: 0.45 }, { x: 3.5, share: 0.55 }], speed: 8.5, color: '#2f7de1',
  },
  pickup: {
    id: 'pickup', name: 'Pickup', mass: 2600, length: 5.3, height: 1.85, wheelR: 0.4,
    axles: [{ x: 1.0, share: 0.5 }, { x: 4.3, share: 0.5 }], speed: 7.5, color: '#6b7a3a',
  },
  van: {
    id: 'van', name: 'Delivery van', mass: 3500, length: 5.9, height: 2.5, wheelR: 0.38,
    axles: [{ x: 1.1, share: 0.58 }, { x: 4.8, share: 0.42 }], speed: 7, color: '#f2b531',
  },
  bus: {
    id: 'bus', name: 'City bus', mass: 14000, length: 12, height: 3.1, wheelR: 0.5,
    axles: [{ x: 3.2, share: 0.65 }, { x: 9.2, share: 0.35 }], speed: 6, color: '#2bb673',
  },
  hgv: {
    id: 'hgv', name: '3-axle tipper', mass: 26000, length: 8.5, height: 3.2, wheelR: 0.52,
    axles: [{ x: 1.3, share: 0.36 }, { x: 2.65, share: 0.36 }, { x: 6.6, share: 0.28 }], speed: 5.5, color: '#e2463b',
  },
  design: {
    id: 'design', name: 'HL-93 design truck', mass: 33200, length: 11, height: 3.6, wheelR: 0.52,
    axles: [{ x: 1.0, share: 0.445 }, { x: 5.3, share: 0.445 }, { x: 9.6, share: 0.11 }], speed: 5, color: '#7d58c9',
  },
};

export const VEHICLE_ORDER: VehicleKind[] = ['car', 'pickup', 'van', 'bus', 'hgv', 'design'];

export const tonnes = (kg: number) => (kg / 1000).toFixed(kg < 10000 ? 1 : 0) + ' t';
