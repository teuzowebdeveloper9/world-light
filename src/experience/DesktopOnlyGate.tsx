/**
 * Tela exibida em celulares/tablets — a cena 3D nunca chega a ser montada.
 */
export function DesktopOnlyGate() {
  return (
    <div className="overlay gate-screen">
      <div className="gate-sun" />
      <h1 className="gate-title">World of Light</h1>
      <p className="gate-message">
        Esta experiência foi criada para computador.
        <br />
        Abra em um PC ou notebook para explorar o mundo.
      </p>
    </div>
  )
}
