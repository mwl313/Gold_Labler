export const VIEW_OPTIONS = ["front", "profile", "mixed", "unknown"] as const;

export type ViewType = (typeof VIEW_OPTIONS)[number];

export type ItemDefinition = {
  key: string;
  label: string;
  group?: string;
};

export const items: ItemDefinition[] = [
  { key: "m01_head", label: "01 머리" },
  { key: "m02_neck", label: "02 목" },
  { key: "m03_neck_plane", label: "03 목: 평면" },
  { key: "m04_eyes", label: "04 눈" },
  { key: "m05_eyebrows", label: "05 눈의 세부: 눈썹" },
  { key: "m06_pupils", label: "06 눈의 세부: 눈동자" },
  { key: "m07_eye_proportion", label: "07 눈의 세부: 비율" },
  { key: "m08_eye_gaze", label: "08 눈의 세부: 응시" },
  { key: "m09_nose", label: "09 코" },
  { key: "m10_nose_plane", label: "10 코: 평면" },
  { key: "m11_mouth", label: "11 입" },
  { key: "m12_lips_plane", label: "12 입술: 평면" },
  { key: "m13_chin_forehead", label: "13 턱과 이마" },
  { key: "m14_chin_projection", label: "14 턱의 돌출" },
  { key: "m15_chin_line", label: "15 턱의 선" },
  { key: "m16_nasal_bridge", label: "16 콧날" },
  { key: "m17_hair_i", label: "17 머리카락 I" },
  { key: "m18_hair_ii", label: "18 머리카락 II" },
  { key: "m19_hair_iii", label: "19 머리카락 III" },
  { key: "m20_ears", label: "20 귀" },
  { key: "m21_ear_proportion_position", label: "21 귀: 비율과 위치" },
  { key: "m22_fingers", label: "22 손가락" },
  { key: "m23_finger_count", label: "23 정확한 수의 손가락" },
  { key: "m24_finger_detail", label: "24 손가락의 정확한 세부" },
  { key: "m25_thumb_differentiation", label: "25 엄지손가락의 분화" },
  { key: "m26_hands", label: "26 손" },
  { key: "m27_wrist_or_ankle", label: "27 손목 또는 발목" },
  { key: "m28_arms", label: "28 팔" },
  { key: "m29_shoulders_i", label: "29 어깨 I" },
  { key: "m30_shoulders_ii", label: "30 어깨 II" },
  { key: "m31_arm_motion", label: "31 옆으로 내리거나 운동하고 있는 팔" },
  { key: "m32_legs", label: "32 다리" },
  { key: "m33_hip_crotch", label: "33 엉덩이 I(가랑이)" },
  { key: "m34_hip_ii", label: "34 엉덩이 II" },
  { key: "m35_knee_joint", label: "35 무릎관절" },
  { key: "m36_feet_i", label: "36 발 I" },
  { key: "m37_feet_proportion", label: "37 발 II: 비율" },
  { key: "m38_feet_heel", label: "38 발 III: 뒷꿈치" },
  { key: "m39_feet_perspective", label: "39 발 IV: 원근법" },
  { key: "m40_limbs_attached_i", label: "40 팔, 다리 달린 것" },
  { key: "m41_limbs_attached_ii", label: "41 팔, 다리 달린 것 II" },
  { key: "m42_torso", label: "42 동체" },
  { key: "m43_torso_proportion_plane", label: "43 동체의 비율: 평면적" },
  { key: "m44_ratio_head_torso", label: "44 비율: 머리와 동체" },
  { key: "m45_ratio_face", label: "45 비율: 얼굴" },
  { key: "m46_ratio_arm_torso", label: "46 비율: 팔과 동체" },
  { key: "m47_ratio_arm", label: "47 비율: 팔" },
  { key: "m48_ratio_leg_torso", label: "48 비율: 다리와 동체" },
  { key: "m49_ratio_limb_vs_hand_foot", label: "49 비율: 팔·다리 > 손·발" },
  { key: "m50_clothes_i", label: "50 옷 I" },
  { key: "m51_clothes_ii", label: "51 옷 II" },
  { key: "m52_clothes_iii", label: "52 옷 III" },
  { key: "m53_clothes_iv", label: "53 옷 IV" },
  { key: "m54_profile_view", label: "54 측면화(옆을 보고 있는 모습)" },
  { key: "m55_motor_coordination", label: "55 운동 조정: 선과 연결" },
  { key: "m56_refined_line_head", label: "56 세련된 선과 형태: 머리윤곽" },
  { key: "m57_refined_line_torso", label: "57 세련된 선과 형태: 동체" },
  { key: "m58_refined_line_face_shape", label: "58 세련된 선과 형태: 얼굴의 모양" },
  { key: "m59_sketch_realism", label: "59 Sketch 및 실제감 표현의 기술" },
  { key: "m60_limb_motion", label: "60 팔과 다리의 운동" },
];

export type ItemKey = (typeof items)[number]["key"];

export function createEmptyItems(): Record<ItemKey, 0 | 1> {
  return items.reduce(
    (acc, item) => {
      acc[item.key as ItemKey] = 0;
      return acc;
    },
    {} as Record<ItemKey, 0 | 1>,
  );
}
