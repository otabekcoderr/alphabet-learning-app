import { CURRICULUM_ITEMS, CURRICULUM_STAGES, type CurriculumItem } from '../data/curriculum';
import type { ItemProgress } from '../logic/pedagogy';

interface StageMapProps {
  progressByItem: Record<string, ItemProgress>;
  reviewQueue: CurriculumItem[];
  onSelectItem: (item: CurriculumItem) => void;
  onStartReview: () => void;
}

export function StageMap({ progressByItem, reviewQueue, onSelectItem, onStartReview }: StageMapProps) {
  return (
    <div className="stage-map">
      <div className="map-topbar">
        <div>
          <h3>📚 Barcha {CURRICULUM_ITEMS.length} ta dars xaritasi</h3>
          <p className="muted-text">
            Unlilar qizil, undoshlar ko‘k rangda. Istalgan darsni ochib tekshirishingiz mumkin.
          </p>
        </div>
        {reviewQueue.length > 0 && (
          <button type="button" className="btn-review" onClick={onStartReview}>
            🔁 Takrorlash mashqi ({reviewQueue.length} ta)
          </button>
        )}
      </div>

      <div className="stages-list">
        {CURRICULUM_STAGES.map((stage) => {
          const items = CURRICULUM_ITEMS.filter((i) => i.stage === stage.stage);
          const masteredCount = items.filter((i) => progressByItem[i.id]?.mastered).length;
          const pct = items.length ? Math.round((masteredCount / items.length) * 100) : 0;

          return (
            <section key={stage.stage} className="stage-card" style={{ borderTopColor: stage.accentColor }}>
              <div className="stage-header">
                <div>
                  <h4>{stage.title}</h4>
                  <p className="stage-subtitle">{stage.subtitle}</p>
                </div>
                <div className="stage-progress-badge">
                  {masteredCount}/{items.length} o‘zlashtirildi ({pct}%)
                </div>
              </div>

              <div className="progress-track" aria-hidden="true">
                <div
                  className="progress-fill"
                  style={{ width: `${pct}%`, backgroundColor: stage.accentColor }}
                />
              </div>

              <p className="stage-science-note">{stage.noteUz}</p>

              <div className="items-grid">
                {items.map((item) => {
                  const prog = progressByItem[item.id];
                  const isMastered = Boolean(prog?.mastered);
                  const isUnverified = prog?.status === 'unverified' && !isMastered;
                  const stars = prog?.stars ?? 0;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`item-card ${isMastered ? 'item-mastered' : ''} ${
                        isUnverified ? 'item-unverified' : ''
                      } kind-${item.kind}`}
                      onClick={() => onSelectItem(item)}
                    >
                      <span className="item-kind-tag">
                        {item.kind === 'letter' ? 'Harf' : item.kind === 'syllable' ? "Bo'g'in" : "So'z"}
                      </span>
                      <span className="item-text">{item.text}</span>
                      <span className="item-stars">
                        {isMastered
                          ? '⭐'.repeat(Math.max(1, stars))
                          : isUnverified
                            ? '⏳ Tasdiqlanmagan'
                            : 'Ochish →'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
