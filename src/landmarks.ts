interface LandmarkPreset {
    id: string;
    label: string;
    icon: string;
}

export const LANDMARK_PRESETS: LandmarkPreset[] = [
    { id: 'gate', label: 'Gate', icon: '🚪' },
    { id: 'bench', label: 'Bench', icon: '🪑' },
    { id: 'crossing', label: 'Crossing', icon: '🚶' },
    { id: 'turn', label: 'Turn', icon: '↪️' },
    { id: 'steps', label: 'Steps', icon: '🪜' },
    { id: 'danger', label: 'Danger', icon: '⚠️' },
];
