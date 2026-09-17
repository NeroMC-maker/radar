import type { brandsModule } from '@radar/core';

type Brand = Awaited<ReturnType<typeof brandsModule.getBrand>>;

/** Campos compartidos por la configuración inicial y la edición del perfil. */
export function BrandFields({ brand, xHandle }: { brand?: Brand; xHandle?: string }) {
  return (
    <>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="name">Nombre de la marca</label>
          <input id="name" name="name" defaultValue={brand?.name} required />
        </div>
        <div className="field">
          <label htmlFor="xHandle">
            Cuenta de X <span className="hint">(publicación simulada por ahora)</span>
          </label>
          <input id="xHandle" name="xHandle" defaultValue={xHandle} placeholder="@tumarca" required />
        </div>
        <div className="field">
          <label htmlFor="industry">Industria y nicho</label>
          <input id="industry" name="industry" defaultValue={brand?.industry} placeholder="Marketing digital para pymes" />
        </div>
        <div className="field">
          <label htmlFor="audience">Audiencia</label>
          <input id="audience" name="audience" defaultValue={brand?.audience} placeholder="community managers" />
        </div>
        <div className="field">
          <label htmlFor="offering">Productos o servicios</label>
          <input id="offering" name="offering" defaultValue={brand?.offering} />
        </div>
        <div className="field">
          <label htmlFor="market">País o mercado</label>
          <input id="market" name="market" defaultValue={brand?.market} placeholder="Perú" />
        </div>
        <div className="field">
          <label htmlFor="language">Idioma</label>
          <select id="language" name="language" defaultValue={brand?.language ?? 'es'}>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="pt">Portugués</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="timezone">Zona horaria</label>
          <input id="timezone" name="timezone" defaultValue={brand?.timezone ?? 'America/Lima'} list="tz" required />
          <datalist id="tz">
            {['America/Lima', 'America/Bogota', 'America/Mexico_City', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'Europe/Madrid', 'UTC'].map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="field">
        <label htmlFor="description">Descripción</label>
        <textarea id="description" name="description" defaultValue={brand?.description} rows={2} />
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="goals">Objetivos de comunicación</label>
          <textarea id="goals" name="goals" defaultValue={brand?.goals} rows={2} />
        </div>
        <div className="field">
          <label htmlFor="positioning">
            Posicionamiento <span className="hint">(sin esto, no se generan opiniones a nombre de la marca)</span>
          </label>
          <textarea id="positioning" name="positioning" defaultValue={brand?.positioning} rows={2} />
        </div>
        <div className="field">
          <label htmlFor="interests">
            Temas de interés <span className="hint">(separados por comas)</span>
          </label>
          <textarea id="interests" name="interests" defaultValue={brand?.interests.join(', ')} rows={2} placeholder="redes sociales, inteligencia artificial" />
        </div>
        <div className="field">
          <label htmlFor="exclusions">
            Temas excluidos <span className="hint">(nunca se recomendarán)</span>
          </label>
          <textarea id="exclusions" name="exclusions" defaultValue={brand?.exclusions.join(', ')} rows={2} placeholder="política, apuestas" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="referents">
          Referentes <span className="hint">(uno por línea, con plataforma explícita: x:usuario, github:org, reddit:usuario)</span>
        </label>
        <textarea
          id="referents"
          name="referents"
          defaultValue={brand?.referents.map((r) => `${r.platform}:${r.handle}`).join('\n')}
          rows={3}
          placeholder={'x:martamkt\ngithub:openpage'}
        />
      </div>
    </>
  );
}
