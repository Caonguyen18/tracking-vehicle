import type { PlateRecord, BoundingBox } from '../types';

/** Giá trị placeholder backend trả về khi không nhận diện được biển số. */
export const NO_PLATE = '[Không rõ]';

/** True nếu chuỗi là một biển số hợp lệ (không rỗng và không phải placeholder). */
export const hasValidPlate = (text?: string | null): boolean =>
  !!text && text !== NO_PLATE && text.trim() !== '';

/** Chuẩn hóa biển số để so khớp: bỏ ký tự không phải chữ/số và viết hoa. */
export const normalizePlate = (text: string): string =>
  text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

/**
 * Nhãn hiển thị trên khung hình, dạng: "[id] - [loại xe]" (kèm biển số nếu có).
 * Ví dụ: "5 - Ô tô" hoặc "5 - Ô tô - 51F12345".
 * Khi không có biển số -> bỏ tag "[Không rõ]" cho đỡ rối.
 */
export const formatVehicleLabel = (id: number, type: string, plateText?: string): string => {
  const base = `${id} - ${type}`;
  return hasValidPlate(plateText) ? `${base} - ${plateText}` : base;
};

/** Thời điểm kết thúc xuất hiện (giây) của một bản ghi video, nếu có. */
const recordEnd = (r: PlateRecord): number | undefined =>
  r.video_start_time !== undefined && r.video_duration !== undefined
    ? r.video_start_time + r.video_duration
    : undefined;

/**
 * Gộp các bản ghi có CÙNG biển số thành một phương tiện duy nhất.
 *
 * Xử lý:
 *  - Xe bị DeepSort mất dấu rồi được gán track_id mới -> cùng biển số -> gộp lại,
 *    không bị đếm/hiển thị 2 lần.
 *  - Biển số trùng -> chỉ tính một lần, không thêm vào danh sách thống kê.
 *
 * Xe KHÔNG có biển số không thể gộp tin cậy nên được giữ là phương tiện riêng.
 * Thứ tự xuất hiện lần đầu được giữ nguyên.
 */
export const dedupeRecordsByPlate = (records: PlateRecord[]): PlateRecord[] => {
  const byPlate = new Map<string, PlateRecord>();
  const result: PlateRecord[] = [];

  for (const rec of records) {
    if (!hasValidPlate(rec.plate_text)) {
      // Không có biển số -> giữ là một xe riêng (không gộp được)
      result.push({ ...rec });
      continue;
    }

    const key = normalizePlate(rec.plate_text);
    const existing = byPlate.get(key);

    if (!existing) {
      const copy = { ...rec };
      byPlate.set(key, copy);
      result.push(copy);
      continue;
    }

    // Biển số trùng -> gộp vào bản ghi đã có, KHÔNG đếm thêm.
    // Ưu tiên thông tin từ bản ghi có độ tin cậy cao hơn.
    if (rec.confidence > existing.confidence) {
      existing.confidence = rec.confidence;
      existing.plate_text = rec.plate_text;
      existing.vehicle_type = rec.vehicle_type;
      if (rec.plate_crop) existing.plate_crop = rec.plate_crop;
    } else if (!existing.plate_crop && rec.plate_crop) {
      existing.plate_crop = rec.plate_crop;
    }

    // Cộng dồn số frame xuất hiện của các đoạn track cùng biển số.
    existing.frames_seen = (existing.frames_seen ?? 0) + (rec.frames_seen ?? 0);

    // Mở rộng khoảng thời gian xuất hiện để bao trùm cả hai đoạn track (video).
    const starts = [existing.video_start_time, rec.video_start_time].filter(
      (v): v is number => v !== undefined
    );
    if (starts.length > 0) {
      const start = Math.min(...starts);
      existing.video_start_time = start;
      const ends = [recordEnd(existing), recordEnd(rec)].filter(
        (v): v is number => v !== undefined
      );
      if (ends.length > 0) {
        existing.video_duration = Math.max(...ends) - start;
      }
    }
  }

  return result;
};

// ===== Ghép lại các xe KHÔNG có biển số bị mất dấu rồi bắt lại =====
// Dedup theo biển số không xử lý được xe không đọc được biển. Khi DeepSort
// mất dấu một xe rồi gán track_id mới, ta dùng tín hiệu thời gian + không gian
// để nhận biết đó là cùng một xe và gộp lại (tránh đếm 2 lần).
//
// Ngưỡng được chọn dè dặt để hạn chế gộp nhầm hai xe khác nhau:
//  - cùng loại xe
//  - track mới bắt đầu NGAY SAU khi track cũ kết thúc, trong khoảng gap ngắn
//  - vị trí (tâm bbox) gần nhau và kích thước tương đương
const STITCH_MAX_GAP_S = 3.0;       // track mới phải bắt đầu trong 3s sau track cũ
const STITCH_OVERLAP_TOL_S = 0.3;   // cho phép chồng lấp thời gian rất nhỏ khi bàn giao
const STITCH_CENTER_DIST_FACTOR = 1.0; // khoảng cách tâm < 1.0 * đường chéo bbox trung bình
const STITCH_SIZE_RATIO = 2.0;      // tỉ lệ kích thước hai bbox phải trong [1/2, 2]

const bboxCenter = (b: BoundingBox) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const bboxDiagonal = (b: BoundingBox) => Math.hypot(b.width, b.height);

/** True nếu hai bbox đủ gần và cùng cỡ để coi là cùng một xe bị mất dấu rồi bắt lại. */
const bboxLikelySameVehicle = (a: BoundingBox, b: BoundingBox): boolean => {
  const ca = bboxCenter(a);
  const cb = bboxCenter(b);
  const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  const avgDiag = (bboxDiagonal(a) + bboxDiagonal(b)) / 2;
  if (avgDiag === 0) return false;
  if (dist > STITCH_CENTER_DIST_FACTOR * avgDiag) return false;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (areaA === 0 || areaB === 0) return false;
  const ratio = areaA > areaB ? areaA / areaB : areaB / areaA;
  return ratio <= STITCH_SIZE_RATIO;
};

/**
 * Gộp các bản ghi KHÔNG có biển số mà nhiều khả năng là cùng một xe
 * (track bị mất rồi bắt lại). Bản ghi CÓ biển số được giữ nguyên (đã dedup
 * theo biển ở bước trước). Chỉ áp dụng cho video (cần thời gian + bbox).
 */
export const stitchPlatelessRecords = (records: PlateRecord[]): PlateRecord[] => {
  const plated = records.filter((r) => hasValidPlate(r.plate_text));
  const plateless = records.filter((r) => !hasValidPlate(r.plate_text));

  // Sắp theo thời gian bắt đầu để ghép track sau vào track trước.
  plateless.sort((a, b) => (a.video_start_time ?? 0) - (b.video_start_time ?? 0));

  const merged: PlateRecord[] = [];

  for (const rec of plateless) {
    const recStart = rec.video_start_time;
    let target: PlateRecord | undefined;

    // Chỉ ghép khi có đủ thông tin thời gian + vị trí.
    if (recStart !== undefined && rec.first_bbox) {
      target = merged.find((m) => {
        if (m.vehicle_type !== rec.vehicle_type) return false;
        const mEnd = recordEnd(m);
        if (mEnd === undefined || !m.last_bbox) return false;
        const gap = recStart - mEnd;
        // track mới bắt đầu ngay sau (gap nhỏ), không chồng lấp nhiều
        if (gap > STITCH_MAX_GAP_S || gap < -STITCH_OVERLAP_TOL_S) return false;
        return bboxLikelySameVehicle(m.last_bbox, rec.first_bbox!);
      });
    }

    if (!target) {
      merged.push({ ...rec });
      continue;
    }

    // Gộp rec vào target: nối thời gian, cập nhật vị trí cuối, giữ tin cậy cao hơn.
    const start = Math.min(target.video_start_time ?? recStart!, recStart!);
    const end = Math.max(recordEnd(target) ?? recStart!, recordEnd(rec) ?? recStart!);
    target.video_start_time = start;
    target.video_duration = end - start;
    if (rec.last_bbox) target.last_bbox = rec.last_bbox;
    if (rec.confidence > target.confidence) {
      target.confidence = rec.confidence;
      target.vehicle_type = rec.vehicle_type;
    }
    if (!target.plate_crop && rec.plate_crop) target.plate_crop = rec.plate_crop;
    target.frames_seen = (target.frames_seen ?? 0) + (rec.frames_seen ?? 0);
  }

  return [...plated, ...merged];
};
