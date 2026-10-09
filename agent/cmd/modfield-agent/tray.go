//go:build !notray

package main

import (
	"context"
	"fmt"
	"time"

	"fyne.io/systray"

	"modfield.dev/agent/internal/agent"
	"modfield.dev/agent/internal/platform"
	"modfield.dev/agent/internal/update"
)

// runTray shows the tray icon. fyne/systray only has menus, no dialogs:
// anything interactive (pairing, revoking) opens a local page instead.
func runTray(ctx context.Context, a *agent.Agent, port int, dataDir string, quit func()) {
	onReady := func() {
		systray.SetIcon(trayIcon())
		systray.SetTitle("")
		systray.SetTooltip("ModField")
		status := systray.AddMenuItem("ModField", "")
		status.Disable()
		systray.AddSeparator()
		open := systray.AddMenuItem("Abrir ModField", "Abre a interface servida pelo agente")
		pair := systray.AddMenuItem("Parear navegador", "Mostra o código de pareamento")
		browsers := systray.AddMenuItem("Navegadores pareados", "Lista e revoga navegadores")
		systray.AddSeparator()
		pause := systray.AddMenuItemCheckbox("Pausar", "Recusa navegadores até desmarcar", false)
		auto := systray.AddMenuItemCheckbox("Atualização automática", "Procura atualizações uma vez por dia", update.Enabled(dataDir))
		systray.AddSeparator()
		exit := systray.AddMenuItem("Sair", "")

		refresh := func() {
			sessions, conns, polls := a.Status()
			state := "ativo"
			if a.Paused() {
				state = "pausado"
			}
			status.SetTitle(fmt.Sprintf("ModField %s · porta %d · %s", a.Version, port, state))
			status.SetTooltip(fmt.Sprintf("%d abas, %d conexões, %d leituras", sessions, conns, polls))
			systray.SetTooltip(fmt.Sprintf("ModField · %d conexões", conns))
		}
		refresh()
		go func() {
			tick := time.NewTicker(2 * time.Second)
			defer tick.Stop()
			for {
				select {
				case <-ctx.Done():
					systray.Quit()
					return
				case <-tick.C:
					refresh()
				case <-open.ClickedCh:
					platform.OpenURL(a.BaseURL + "/pt/")
				case <-pair.ClickedCh:
					platform.OpenURL(a.BaseURL + "/pair")
				case <-browsers.ClickedCh:
					platform.OpenURL(a.BaseURL + "/browsers")
				case <-pause.ClickedCh:
					if pause.Checked() {
						pause.Uncheck()
						a.SetPaused(false)
					} else {
						pause.Check()
						a.SetPaused(true)
					}
					refresh()
				case <-auto.ClickedCh:
					on := !auto.Checked()
					if on {
						auto.Check()
					} else {
						auto.Uncheck()
					}
					_ = update.SetEnabled(dataDir, on)
				case <-exit.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
	}
	systray.Run(onReady, quit)
}
