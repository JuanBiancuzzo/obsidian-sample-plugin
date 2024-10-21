import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, DropdownComponent, ButtonComponent, MarkdownRenderer, Component } from 'obsidian';

interface OrdenarArchivosPluginSettings {
	metricas: string[];
}

const DEFAULT_SETTINGS: OrdenarArchivosPluginSettings = {
	metricas: []
}

export default class OrdenarArchivosPlugin extends Plugin {
	settings: OrdenarArchivosPluginSettings;
	dv: undefined | Plugin;

	async onload() {
		await this.loadSettings();

		this.app.workspace.onLayoutReady(() => {
			this.dv = this.app.plugins.plugins["dataview"]?.api;
		})

		// This adds a simple command that can be triggered anywhere
		for (let metrica of this.settings.metricas) {
			this.agregarMetrica(metrica);
		}

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	console.log('click', evt);
		// });

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	agregarMetrica(metrica: string): void {
		this.addCommand({
			id: `open-reordenar-${this.tenerMetricaId(metrica)}`,
			name: `Reordenar ${metrica}`,
			callback: async () => {
				new ReordenarModal(this.app, this.dv, metrica).open();
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
	component: Component;
	archivos: {}[];
	ultima: number[];

	constructor(app: App, dv: Plugin, metrica: string) {
		super(app);
		this.metrica = metrica;
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

		this.setTitle(`Ahora vamos a reordenar ${this.metrica}`)
		this.modalEl.addClass("ordenar-ventana");

		let [ indiceUno, indiceDos ] = this.conseguirArchivos();
		let [ archivoUno, archivoDos ] = [ indiceUno, indiceDos ].map(indice => this.archivos[indice]);
		let tArchivoUno = this.app.vault.getAbstractFileByPath(archivoUno.path);
		let tArchivoDos = this.app.vault.getAbstractFileByPath(archivoDos.path);

		let [ contenidoUno, contenidoDos ] = (await Promise.all([
			this.app.vault.read(tArchivoUno),
			this.app.vault.read(tArchivoDos)
		])).map(contenido => this.sacarFrontmatter(contenido));

		let separacion = contentEl.createDiv();
		separacion.addClass("ordenar-separacion");
		

		let divIzquierda = new ButtonComponent(separacion)
			.setClass("ordenar-archivo")
			.onClick(async () => {
				let metricaMejor = archivoUno.metrica;
            	let metricaPeor = archivoDos.metrica;

				if ( parseInt(metricaMejor, 10) > parseInt(metricaPeor, 10) ) {
					this.archivos[indiceUno]["metrica"] = metricaPeor;
					this.archivos[indiceDos]["metrica"] = metricaMejor;
				}
				await this.onClose(); 
				this.onOpen();
			})
			.buttonEl;

		let tareaIzquierda = MarkdownRenderer
			.render(this.app, `# ${archivoUno.name}\n---\n${contenidoUno}`, divIzquierda.createDiv({ cls: "ordenar-archivo-contenido" }), "", this.component);

		let divDerecha = new ButtonComponent(separacion)
			.setClass("ordenar-archivo")
			.onClick(async () => {
				let metricaMejor = archivoDos.metrica;
            	let metricaPeor = archivoUno.metrica;

				if ( parseInt(metricaMejor, 10) > parseInt(metricaPeor, 10) ) {
					this.archivos[indiceDos]["metrica"] = metricaPeor;
					this.archivos[indiceUno]["metrica"] = metricaMejor;
				}
				await this.onClose(); 
				this.onOpen();
			})
			.buttonEl;

		let tareaDerecha = MarkdownRenderer
			.render(this.app, `# ${archivoDos.name}\n---\n${contenidoDos}`, divDerecha.createDiv({ cls: "ordenar-archivo-contenido" }), "", this.component);

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

		return (this.archivos[indicePrincipal].metrica < this.archivos[indiceSecundario].metrica) 
			? [ indicePrincipal, indiceSecundario ]
			: [ indiceSecundario, indicePrincipal ];
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

		if (this.plugin.settings.metricas.length > 0) {
			for (let [indice, metrica] of this.plugin.settings.metricas.entries()) {
				new Setting(containerEl)
					.setName(`Setting #${indice + 1}`)
					.setDesc('It\'s a secret')
					.addDropdown(dropdown => {
						for (let otrasMetrica of posiblesMetricas) {
							if (otrasMetrica != metrica && this.plugin.settings.metricas.indexOf(otrasMetrica) >= 0)
								continue

							dropdown = dropdown.addOption(otrasMetrica, otrasMetrica);
						}

						dropdown = dropdown.onChange(async (value) => {
							if (metrica) this.plugin.eliminarMetrica(metrica);
							this.plugin.settings.metricas[indice] = value;
							this.plugin.agregarMetrica(value);
							await this.plugin.saveSettings();
						}).setValue(metrica);

						return dropdown;
					});
			}
		}

		let botones = containerEl.createDiv();
		botones.addClass("ordenar-botones")

		if (this.plugin.settings.metricas.length > 0) {
			new ButtonComponent(botones)
				.setClass("ordenar-boton")
				.setButtonText("Eliminar métrica")
				.setTooltip("Apretar")
				.onClick(async () => {
					new Notice("Eliminando")
					let metrica = this.plugin.settings.metricas.pop();
					if (metrica && metrica.trim() != "") {
						this.plugin.eliminarMetrica(metrica);
					}

					await this.plugin.saveSettings();
					this.display();
				});
		}

		if (posiblesMetricas.length > this.plugin.settings.metricas.length) {
			new ButtonComponent(botones)
				.setClass("ordenar-boton")
				.setButtonText("Agregar métrica")
				.setTooltip("Apretar")
				.onClick(async () => {
					new Notice("Agregando")
					let metricaNoUsada = posiblesMetricas
						.find(metrica => this.plugin.settings.metricas.indexOf(metrica) < 0);
					this.plugin.settings.metricas.push(metricaNoUsada ? metricaNoUsada : "");
					this.plugin.agregarMetrica(metricaNoUsada ? metricaNoUsada : "");
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
