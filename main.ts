import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, DropdownComponent, ButtonComponent, MarkdownRenderer, Component } from 'obsidian';

class Metrica {
	nombre: string;
	esAscendiente: boolean;

	constructor(nombre: string, esAscendiente: boolean) {
		this.nombre = nombre;
		this.esAscendiente = esAscendiente;
	} 
}

interface OrdenarArchivosPluginSettings {
	metricas: string[];
	esAscendientes: boolean[];
}

const DEFAULT_SETTINGS: OrdenarArchivosPluginSettings = {
	metricas: [],
	esAscendientes: [],
}

export default class OrdenarArchivosPlugin extends Plugin {
	settings: Metrica[] = [];
	dv: undefined | Plugin;
	modal: undefined | ReordenarModal;

	async onload() {
		await this.loadSettings();

		this.app.workspace.onLayoutReady(() => {
			this.dv = this.app.plugins.plugins["dataview"]?.api;
		})

		// This adds a simple command that can be triggered anywhere
		for (let metrica of this.settings) {
			this.agregarMetrica(metrica.nombre, metrica.esAscendiente);
		}

		this.registerDomEvent(document, 'keydown', async (event: KeyboardEvent) => {
			if (event.code == "KeyL" && this.modal) {
				await this.modal.establecerComparacion('der');
			} else if (event.code == "KeyJ" && this.modal) {
				await this.modal.establecerComparacion('izq');
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		let resultado: OrdenarArchivosPluginSettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		for (let [indice, metrica] of resultado.metricas.entries()) {
			let esAscendiente = (indice < resultado.esAscendientes.length)
				? resultado.esAscendientes[indice]
				: false;
			if (this.settings.findIndex(objMetrica => objMetrica.nombre == metrica) < 0)
				this.settings.push(new Metrica(metrica, esAscendiente));
		}
	}

	async saveSettings() {
		let settings: OrdenarArchivosPluginSettings = DEFAULT_SETTINGS;
		for (let metrica of this.settings) {
			settings.metricas.push(metrica.nombre);
			settings.esAscendientes.push(metrica.esAscendiente);
		}
		await this.saveData(settings);
	}

	agregarMetrica(metrica: string, esAscendiente: boolean): void {
		this.addCommand({
			id: `open-reordenar-${this.tenerMetricaId(metrica)}`,
			name: `Reordenar ${metrica}`,
			callback: async () => {
				if (this.modal) {
					await this.modal.onClose();
					this.modal.close();
				}
				this.modal = new ReordenarModal(this.app, this.dv, metrica, esAscendiente);
				await this.modal.open();
			}
		});
	}

	eliminarMetrica(metrica: string): void {
		this.removeCommand(`open-reordenar-${this.tenerMetricaId(metrica)}`);
	}

	tenerMetricaId(metrica: string): string {
		metrica = metrica.trim();
		let resultado = "";
		for (let i = 0; i < metrica.length; i++) {
			resultado += (metrica[i] == " ") ? "-" : metrica.charAt(i);
		}
		return resultado;
	}
}


class ReordenarModal extends Modal {
	metrica: string;
	esAscendente: boolean;

	component: Component;
	archivos: Record<string, string>[];
	ultima: number[];

	indiceIzq: number;
	indiceDer: number;

	constructor(app: App, dv: Plugin, metrica: string, esAscendente: boolean) {
		super(app);
		this.metrica = metrica;
		this.esAscendente = esAscendente;

		this.component = new Component();
		this.archivos = dv.pages()
			.filter(archivo => archivo[this.metrica])
			.sort(archivo => archivo[this.metrica])
			.map(archivo => ({ 
				path: archivo.file.path, 
				name: archivo.file.name, 
				metrica: archivo[metrica] 
			}));
		this.ultima = [];
	}

	async onOpen(): Promise<void> {
		const {contentEl} = this;
		this.component.load();

		this.setTitle(`Seleccionar cual es mejor según "${this.metrica}"`);
		this.modalEl.addClass("ordenar-ventana");

		[ this.indiceIzq, this.indiceDer ] = this.conseguirArchivos();
		let [ archivoUno, archivoDos ] = [ this.indiceDer, this.indiceIzq ].map(indice => this.archivos[indice]);
		let [ tArchivoUno, tArchivoDos ] = [ archivoUno, archivoDos ].map(archivo => this.app.vault.getAbstractFileByPath(archivo.path));

		let [ contenidoUno, contenidoDos ] = (await Promise.all([
			this.app.vault.read(tArchivoUno),
			this.app.vault.read(tArchivoDos)
		])).map(contenido => this.sacarFrontmatter(contenido));

		let separacion = contentEl.createDiv();
		separacion.addClass("ordenar-separacion");
		

		let divIzquierda = new ButtonComponent(separacion)
			.setClass("ordenar-archivo")
			.onClick(async () => await this.establecerComparacion('izq'))
			.buttonEl;

		let tareaIzquierda = MarkdownRenderer
			.render(
				this.app, `# ${archivoUno.name}\n---\n${contenidoUno}`, 
				divIzquierda.createDiv({ cls: "ordenar-archivo-contenido" }), 
				archivoUno.path, 
				this.component
			);

		let divDerecha = new ButtonComponent(separacion)
			.setClass("ordenar-archivo")
			.onClick(async () => await this.establecerComparacion('der'))
			.buttonEl;

		let tareaDerecha = MarkdownRenderer
			.render(
				this.app, `# ${archivoDos.name}\n---\n${contenidoDos}`, 
				divDerecha.createDiv({ cls: "ordenar-archivo-contenido" }), 
				archivoDos.path,
				this.component
			);

		await Promise.all([ tareaIzquierda, tareaDerecha ]);
	}

	async onClose(): Promise<void> {
		const {contentEl} = this;
		contentEl.empty();

		this.component.unload();

		if (!this.ultima) return;

		let tareas = this.ultima.map(indice => this.archivos[indice])
			.map(({ path, name, metrica }) => {
				let tArchivo = this.app.vault.getAbstractFileByPath(path);

				return this.app.fileManager.processFrontMatter(tArchivo, (frontmatter) => {
					frontmatter[this.metrica] = metrica;
				})
			});

		await Promise.all(tareas);
	}

	async establecerComparacion(dir) {
		let indiceMejor = (dir == 'der') ? this.indiceDer : this.indiceIzq;
		let indicePeor = (dir == 'der') ? this.indiceIzq : this.indiceDer;

		let metricaMejor = this.archivos[indiceMejor].metrica;
		let metricaPeor = this.archivos[indicePeor].metrica;

		if (this.debeCambiar(parseInt(metricaMejor, 10), parseInt(metricaPeor, 10))) {
			this.archivos[indiceMejor]["metrica"] = metricaPeor;
			this.archivos[indicePeor]["metrica"] = metricaMejor;

		}

		await this.onClose();
		this.onOpen();
	}

	debeCambiar(metricaMejor, metricaPeor) {
		if (this.esAscendente) return metricaMejor > metricaPeor;
		return metricaMejor < metricaPeor;
	}

	sacarFrontmatter(contenido: string): string {
		if (contenido.slice(0, 3) != "---")
			return contenido;
		contenido = contenido.slice(3);
		
		let indice = contenido.indexOf("---")
		indice += contenido.slice(indice).indexOf("\n") + 1;

		return contenido.slice(indice);
	}

	conseguirArchivos() {
		let indicePrincipal, indiceSecundario;

		do {
        	indicePrincipal = Math.floor(Math.random() * this.archivos.length);
			indiceSecundario = indicePrincipal == 0 ? 1 : indicePrincipal - 1;

		} while (
			this.ultima.length > 0 && 
			( (this.ultima[0] == indicePrincipal && this.ultima[1] == indiceSecundario) ||
			  (this.ultima[1] == indicePrincipal && this.ultima[0] == indiceSecundario) )
		);
		
		this.ultima[0] = indicePrincipal;
		this.ultima[1] = indiceSecundario;

		let condicion = this.esAscendente 
			? this.archivos[indicePrincipal].metrica < this.archivos[indiceSecundario].metrica
			: this.archivos[indicePrincipal].metrica > this.archivos[indiceSecundario].metrica;

		return condicion
			? [indicePrincipal, indiceSecundario]
			: [indiceSecundario, indicePrincipal];

    }
}

class SampleSettingTab extends PluginSettingTab {
	plugin: OrdenarArchivosPlugin;

	constructor(app: App, plugin: OrdenarArchivosPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl("h1", { text: "Configuración" })

		if (!this.plugin.dv) {
			containerEl.createEl("span", { text: "No se tiene instalado Dataview" })
			return;
		}
		
		let posiblesMetricas = this.obtenerMetricas();
		if (posiblesMetricas.length == 0) {
			containerEl.createEl("span", { text: "No hay posibles metricas para elegir" })
			return;
		}

		if (this.plugin.settings.length > 0) {
			for (let [indice, metrica] of this.plugin.settings.entries()) {
				new Setting(containerEl)
					.setName(`Setting #${indice + 1}`)
					.setDesc('It\'s a secret')
					.addToggle(toggle => toggle
						.setValue(metrica.esAscendiente)
						.setTooltip("Si se activa es ascendente")
						.onChange(async (value) => { 
							let metricaVieja = this.plugin.settings[indice];
							this.plugin.eliminarMetrica(metricaVieja.nombre);

							this.plugin.settings[indice] = new Metrica(metricaVieja.nombre, value);
							this.plugin.agregarMetrica(metricaVieja.nombre, value);
							await this.plugin.saveSettings();
						})
					)
					.addDropdown(dropdown => {
						for (let otrasMetrica of posiblesMetricas) {
							if (otrasMetrica != metrica.nombre && this.plugin.settings.findIndex(m => m.nombre == otrasMetrica) >= 0)
								continue

							dropdown = dropdown.addOption(otrasMetrica, otrasMetrica);
						}

						return dropdown.onChange(async (value) => {
							let metricaVieja = this.plugin.settings[indice];
							this.plugin.eliminarMetrica(metricaVieja.nombre);

							this.plugin.settings[indice] = new Metrica(value, metricaVieja.esAscendiente);
							this.plugin.agregarMetrica(value, metricaVieja.esAscendiente);
							await this.plugin.saveSettings();
						}).setValue(metrica.nombre);
					});
			}
		}

		let botones = containerEl.createDiv();
		botones.addClass("ordenar-botones")

		if (this.plugin.settings.length > 0) {
			new ButtonComponent(botones)
				.setClass("ordenar-boton")
				.setButtonText("Eliminar métrica")
				.setTooltip("Apretar")
				.onClick(async () => {
					new Notice("Eliminando")
					let metrica = this.plugin.settings.pop();
					if (metrica && metrica.nombre.trim() != "") {
						this.plugin.eliminarMetrica(metrica.nombre);
					}

					await this.plugin.saveSettings();
					this.display();
				});
		}

		if (posiblesMetricas.length > this.plugin.settings.length) {
			new ButtonComponent(botones)
				.setClass("ordenar-boton")
				.setButtonText("Agregar métrica")
				.setTooltip("Apretar")
				.onClick(async () => {
					new Notice("Agregando")
					let metricaNoUsada = posiblesMetricas
						.find(metrica => this.plugin.settings.findIndex(m => m.nombre == metrica));
					this.plugin.settings.push(new Metrica(metricaNoUsada ? metricaNoUsada : "", false));
					this.plugin.agregarMetrica(metricaNoUsada ? metricaNoUsada : "", false);
					await this.plugin.saveSettings();
					this.display();
				});
		}
	}

	obtenerMetricas(): string[] {
		return this.plugin.dv?.pages()
			.flatMap(archivo => Object.entries(archivo.file.frontmatter)
			.map(([key, value]) => key))
			.groupBy(key => key)
			.filter(({ key, rows }) => rows.length > 2)
			.map(({ key, rows }) => key)
			.values;
	}
}
