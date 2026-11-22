/* ============================================================
 * rigging/skeleton.js — Bone class + 8 preset skeleton humanoid
 * ============================================================ */
(function () {
  'use strict';

  function Bone(name, parentName, position, side) {
    this.name = name;
    this.parentName = parentName || null;
    this.position = position;   // [x,y,z] tỷ lệ chuẩn humanoid (0..1)
    this.side = side || 'center'; // center | L | R
    this.children = [];
    this.worldPos = null;       // THREE.Vector3 sau khi build
    this.object3D = null;       // joint visual
  }

  /* ---------- Preset definitions (tỷ lệ theo chiều cao model) ---------- */
  const PRESETS = {
    'Mixamo Compatible': {
      prefix: 'mixamorig:',
      bones: [
        ['Hips', null, [0, 0.50, 0], 'center'],
        ['Spine', 'Hips', [0, 0.56, 0], 'center'],
        ['Chest', 'Spine', [0, 0.63, 0], 'center'],
        ['Neck', 'Chest', [0, 0.72, 0], 'center'],
        ['Head', 'Neck', [0, 0.78, 0], 'center'],
        ['LeftShoulder', 'Chest', [-0.12, 0.70, 0], 'L'],
        ['LeftArm', 'LeftShoulder', [-0.24, 0.70, 0], 'L'],
        ['LeftForeArm', 'LeftArm', [-0.40, 0.70, 0], 'L'],
        ['LeftHand', 'LeftForeArm', [-0.52, 0.70, 0], 'L'],
        ['RightShoulder', 'Chest', [0.12, 0.70, 0], 'R'],
        ['RightArm', 'RightShoulder', [0.24, 0.70, 0], 'R'],
        ['RightForeArm', 'RightArm', [0.40, 0.70, 0], 'R'],
        ['RightHand', 'RightForeArm', [0.52, 0.70, 0], 'R'],
        ['LeftUpLeg', 'Hips', [-0.12, 0.44, 0], 'L'],
        ['LeftLeg', 'LeftUpLeg', [-0.12, 0.24, 0], 'L'],
        ['LeftFoot', 'LeftLeg', [-0.12, 0.04, 0.02], 'L'],
        ['LeftToeBase', 'LeftFoot', [-0.12, 0.02, 0.12], 'L'],
        ['RightUpLeg', 'Hips', [0.12, 0.44, 0], 'R'],
        ['RightLeg', 'RightUpLeg', [0.12, 0.24, 0], 'R'],
        ['RightFoot', 'RightLeg', [0.12, 0.04, 0.02], 'R'],
        ['RightToeBase', 'RightFoot', [0.12, 0.02, 0.12], 'R']
      ]
    },
    'Human Basic': {
      prefix: '',
      bones: [
        ['Hips', null, [0, 0.5, 0], 'center'],
        ['Spine', 'Hips', [0, 0.6, 0], 'center'],
        ['Head', 'Spine', [0, 0.8, 0], 'center'],
        ['ArmL', 'Spine', [-0.3, 0.7, 0], 'L'],
        ['ArmR', 'Spine', [0.3, 0.7, 0], 'R'],
        ['LegL', 'Hips', [-0.12, 0.25, 0], 'L'],
        ['LegR', 'Hips', [0.12, 0.25, 0], 'R']
      ]
    },
    'Human Advanced': {
      prefix: '',
      bones: [
        ['Hips', null, [0, 0.50, 0], 'center'],
        ['Spine', 'Hips', [0, 0.58, 0], 'center'],
        ['Chest', 'Spine', [0, 0.66, 0], 'center'],
        ['Neck', 'Chest', [0, 0.74, 0], 'center'],
        ['Head', 'Neck', [0, 0.80, 0], 'center'],
        ['HeadTop', 'Head', [0, 0.95, 0], 'center'],
        ['ShoulderL', 'Chest', [-0.10, 0.72, 0], 'L'],
        ['UpperArmL', 'ShoulderL', [-0.24, 0.72, 0], 'L'],
        ['LowerArmL', 'UpperArmL', [-0.42, 0.72, 0], 'L'],
        ['HandL', 'LowerArmL', [-0.54, 0.72, 0], 'L'],
        ['FingerL', 'HandL', [-0.60, 0.72, 0], 'L'],
        ['ShoulderR', 'Chest', [0.10, 0.72, 0], 'R'],
        ['UpperArmR', 'ShoulderR', [0.24, 0.72, 0], 'R'],
        ['LowerArmR', 'UpperArmR', [0.42, 0.72, 0], 'R'],
        ['HandR', 'LowerArmR', [0.54, 0.72, 0], 'R'],
        ['FingerR', 'HandR', [0.60, 0.72, 0], 'R'],
        ['UpperLegL', 'Hips', [-0.11, 0.45, 0], 'L'],
        ['LowerLegL', 'UpperLegL', [-0.11, 0.25, 0], 'L'],
        ['FootL', 'LowerLegL', [-0.11, 0.04, 0.02], 'L'],
        ['ToeL', 'FootL', [-0.11, 0.02, 0.11], 'L'],
        ['UpperLegR', 'Hips', [0.11, 0.45, 0], 'R'],
        ['LowerLegR', 'UpperLegR', [0.11, 0.25, 0], 'R'],
        ['FootR', 'LowerLegR', [0.11, 0.04, 0.02], 'R'],
        ['ToeR', 'FootR', [0.11, 0.02, 0.11], 'R']
      ]
    },
    'Game Character': {
      prefix: '',
      bones: [
        ['Root', null, [0, 0, 0], 'center'],
        ['Hips', 'Root', [0, 0.5, 0], 'center'],
        ['Spine', 'Hips', [0, 0.6, 0], 'center'],
        ['Chest', 'Spine', [0, 0.7, 0], 'center'],
        ['Neck', 'Chest', [0, 0.76, 0], 'center'],
        ['Head', 'Neck', [0, 0.82, 0], 'center'],
        ['ClavicleL', 'Chest', [-0.08, 0.72, 0], 'L'],
        ['UpperArmL', 'ClavicleL', [-0.26, 0.72, 0], 'L'],
        ['LowerArmL', 'UpperArmL', [-0.44, 0.72, 0], 'L'],
        ['HandL', 'LowerArmL', [-0.55, 0.72, 0], 'L'],
        ['ClavicleR', 'Chest', [0.08, 0.72, 0], 'R'],
        ['UpperArmR', 'ClavicleR', [0.26, 0.72, 0], 'R'],
        ['LowerArmR', 'UpperArmR', [0.44, 0.72, 0], 'R'],
        ['HandR', 'LowerArmR', [0.55, 0.72, 0], 'R'],
        ['UpperLegL', 'Hips', [-0.11, 0.44, 0], 'L'],
        ['LowerLegL', 'UpperLegL', [-0.11, 0.22, 0], 'L'],
        ['FootL', 'LowerLegL', [-0.11, 0.03, 0.03], 'L'],
        ['UpperLegR', 'Hips', [0.11, 0.44, 0], 'R'],
        ['LowerLegR', 'UpperLegR', [0.11, 0.22, 0], 'R'],
        ['FootR', 'LowerLegR', [0.11, 0.03, 0.03], 'R']
      ]
    },
    'Stylized Character': {
      prefix: '',
      bones: [
        ['Hips', null, [0, 0.42, 0], 'center'],
        ['Spine', 'Hips', [0, 0.55, 0], 'center'],
        ['Head', 'Spine', [0, 0.82, 0], 'center'],   /* đầu chibi to */
        ['ArmL', 'Spine', [-0.34, 0.62, 0], 'L'],
        ['HandL', 'ArmL', [-0.5, 0.5, 0], 'L'],
        ['ArmR', 'Spine', [0.34, 0.62, 0], 'R'],
        ['HandR', 'ArmR', [0.5, 0.5, 0], 'R'],
        ['LegL', 'Hips', [-0.14, 0.2, 0], 'L'],
        ['FootL', 'LegL', [-0.14, 0.03, 0.03], 'L'],
        ['LegR', 'Hips', [0.14, 0.2, 0], 'R'],
        ['FootR', 'LegR', [0.14, 0.03, 0.03], 'R']
      ]
    },
    'UE5 Mannequin': {
      prefix: '',
      bones: [
        ['root', null, [0, 0, 0], 'center'],
        ['pelvis', 'root', [0, 0.52, 0], 'center'],
        ['spine_01', 'pelvis', [0, 0.60, 0], 'center'],
        ['spine_02', 'spine_01', [0, 0.68, 0], 'center'],
        ['spine_03', 'spine_02', [0, 0.72, 0], 'center'],
        ['neck_01', 'spine_03', [0, 0.76, 0], 'center'],
        ['head', 'neck_01', [0, 0.80, 0], 'center'],
        ['clavicle_l', 'spine_03', [-0.10, 0.72, 0], 'L'],
        ['upperarm_l', 'clavicle_l', [-0.20, 0.70, 0], 'L'],
        ['lowerarm_l', 'upperarm_l', [-0.34, 0.69, 0.01], 'L'],
        ['hand_l', 'lowerarm_l', [-0.44, 0.68, 0.02], 'L'],
        ['clavicle_r', 'spine_03', [0.10, 0.72, 0], 'R'],
        ['upperarm_r', 'clavicle_r', [0.20, 0.70, 0], 'R'],
        ['lowerarm_r', 'upperarm_r', [0.34, 0.69, 0.01], 'R'],
        ['hand_r', 'lowerarm_r', [0.44, 0.68, 0.02], 'R'],
        ['thigh_l', 'pelvis', [-0.09, 0.44, 0], 'L'],
        ['calf_l', 'thigh_l', [-0.09, 0.24, 0.01], 'L'],
        ['foot_l', 'calf_l', [-0.09, 0.045, 0.02], 'L'],
        ['ball_l', 'foot_l', [-0.09, 0.02, 0.10], 'L'],
        ['thigh_r', 'pelvis', [0.09, 0.44, 0], 'R'],
        ['calf_r', 'thigh_r', [0.09, 0.24, 0.01], 'R'],
        ['foot_r', 'calf_r', [0.09, 0.045, 0.02], 'R'],
        ['ball_r', 'foot_r', [0.09, 0.02, 0.10], 'R']
      ]
    },
    'Unity Humanoid': {
      prefix: '',
      bones: [
        ['Hips', null, [0, 0.52, 0], 'center'],
        ['Spine', 'Hips', [0, 0.60, 0], 'center'],
        ['Chest', 'Spine', [0, 0.68, 0], 'center'],
        ['Neck', 'Chest', [0, 0.76, 0], 'center'],
        ['Head', 'Neck', [0, 0.80, 0], 'center'],
        ['LeftShoulder', 'Chest', [-0.10, 0.72, 0], 'L'],
        ['LeftUpperArm', 'LeftShoulder', [-0.20, 0.70, 0], 'L'],
        ['LeftLowerArm', 'LeftUpperArm', [-0.34, 0.69, 0.01], 'L'],
        ['LeftHand', 'LeftLowerArm', [-0.44, 0.68, 0.02], 'L'],
        ['RightShoulder', 'Chest', [0.10, 0.72, 0], 'R'],
        ['RightUpperArm', 'RightShoulder', [0.20, 0.70, 0], 'R'],
        ['RightLowerArm', 'RightUpperArm', [0.34, 0.69, 0.01], 'R'],
        ['RightHand', 'RightLowerArm', [0.44, 0.68, 0.02], 'R'],
        ['LeftUpperLeg', 'Hips', [-0.09, 0.44, 0], 'L'],
        ['LeftLowerLeg', 'LeftUpperLeg', [-0.09, 0.24, 0.01], 'L'],
        ['LeftFoot', 'LeftLowerLeg', [-0.09, 0.045, 0.02], 'L'],
        ['LeftToes', 'LeftFoot', [-0.09, 0.02, 0.10], 'L'],
        ['RightUpperLeg', 'Hips', [0.09, 0.44, 0], 'R'],
        ['RightLowerLeg', 'RightUpperLeg', [0.09, 0.24, 0.01], 'R'],
        ['RightFoot', 'RightLowerLeg', [0.09, 0.045, 0.02], 'R'],
        ['RightToes', 'RightFoot', [0.09, 0.02, 0.10], 'R']
      ]
    },
    'Custom Skeleton': {
      prefix: '',
      bones: [
        ['Root', null, [0, 0.5, 0], 'center']
      ]
    }
  };

  /* Build map name -> Bone */
  function buildFromPreset(presetName) {
    const preset = PRESETS[presetName];
    if (!preset) return null;
    const map = {};
    preset.bones.forEach(function (def) {
      const bone = new Bone((preset.prefix || '') + def[0], def[1] ? (preset.prefix || '') + def[1] : null, def[2], def[3]);
      map[bone.name] = bone;
    });
    /* nối children */
    Object.keys(map).forEach(function (name) {
      const b = map[name];
      if (b.parentName && map[b.parentName]) map[b.parentName].children.push(b);
    });
    return { preset: preset, bones: map, name: presetName };
  }

  window.PixiStudio.Skeleton = {
    Bone: Bone,
    PRESETS: PRESETS,
    buildFromPreset: buildFromPreset
  };
})();
