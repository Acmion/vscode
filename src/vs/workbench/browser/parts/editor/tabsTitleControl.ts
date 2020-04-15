import { TitleControl } from 'vs/workbench/browser/parts/editor/titleControl';
import { IEditorGroupsAccessor, IEditorGroupView } from 'vs/workbench/browser/parts/editor/editor';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IUntitledEditorService } from 'vs/workbench/services/untitled/common/untitledEditorService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { IQuickOpenService } from 'vs/platform/quickOpen/common/quickOpen';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { ILabelService } from 'vs/platform/label/common/label';
import { TabsEditorControl } from 'vs/workbench/browser/parts/editor/tabsEditorControl';
import { addClass, addDisposableListener, EventType, hasClass, EventHelper, removeClass, Dimension } from 'vs/base/browser/dom';
import { breadcrumbsBackground } from 'vs/platform/theme/common/colorRegistry';
import { IEditorInput, IEditorPartOptions } from 'vs/workbench/common/editor';
import { ScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { DragAndDropObserver, DraggedEditorIdentifier } from 'vs/workbench/browser/dnd';

export class TabsTitleControl extends TitleControl {

	private titleContainer: HTMLElement | undefined;
	private editorToolbarContainer: HTMLElement | undefined;

	private tabsEditorControl: TabsEditorControl;
	private hardPinnedTabsEditorControl: TabsEditorControl;

	private dimension: Dimension | undefined;

	constructor(
		parent: HTMLElement,
		accessor: IEditorGroupsAccessor,
		group: IEditorGroupView,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IUntitledEditorService private readonly untitledEditorService: IUntitledEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ITelemetryService telemetryService: ITelemetryService,
		@INotificationService notificationService: INotificationService,
		@IMenuService menuService: IMenuService,
		@IQuickOpenService quickOpenService: IQuickOpenService,
		@IThemeService themeService: IThemeService,
		@IExtensionService extensionService: IExtensionService,
		@IConfigurationService configurationService: IConfigurationService,
		@IFileService fileService: IFileService,
		@ILabelService labelService: ILabelService
	) {
		super(parent, accessor, group, contextMenuService, instantiationService, contextKeyService, keybindingService, telemetryService, notificationService, menuService, quickOpenService, themeService, extensionService, configurationService, fileService, labelService);

	}

	protected create(parent: HTMLElement): void {
		this.titleContainer = parent;

		// Tabs and Actions Container (are on a single row with flex side-by-side)
		const tabsAndActionsContainer = document.createElement('div');
		addClass(tabsAndActionsContainer, 'tabs-and-actions-container');
		this.titleContainer.appendChild(tabsAndActionsContainer);

		this.tabsEditorControl = this.instantiationService.createInstance(TabsEditorControl, this);
		this.hardPinnedTabsEditorControl = this.instantiationService.createInstance(TabsEditorControl, this);

		// Editor Toolbar Container
		this.editorToolbarContainer = document.createElement('div');
		addClass(this.editorToolbarContainer, 'editor-actions');
		tabsAndActionsContainer.appendChild(this.editorToolbarContainer);

		// Editor Actions Toolbar
		this.createEditorActionsToolBar(this.editorToolbarContainer);

		// Breadcrumbs (are on a separate row below tabs and actions)
		const breadcrumbsContainer = document.createElement('div');
		addClass(breadcrumbsContainer, 'tabs-breadcrumbs');
		this.titleContainer.appendChild(breadcrumbsContainer);
		this.createBreadcrumbsControl(breadcrumbsContainer, { showFileIcons: true, showSymbolIcons: true, showDecorationColors: false, breadcrumbsBackground: breadcrumbsBackground });

	}

	public getGroup(): IEditorGroupView {
		return this.group;
	}
	public getAccessor(): IEditorGroupsAccessor {
		return this.accessor;
	}
	public getInstationService(): IInstantiationService {
		return this.instantiationService;
	}

	protected handleBreadcrumbsEnablementChange(): void {
		this.tabsEditorControl.handleBreadcrumbsEnablementChange();
		this.hardPinnedTabsEditorControl.handleBreadcrumbsEnablementChange();
	}


	public updateEditorActionsToolbar(): void {
		super.updateEditorActionsToolbar();

		// Changing the actions in the toolbar can have an impact on the size of the
		// tab container, so we need to layout the tabs to make sure the active is visible.
		// Hard pinned tabs are always visible, no need change anything then.
		if (this.group.activeEditor) {
			if (!this.group.activeEditor.isHardPinned()) {
				this.layout(this.dimension);
			}
		} else {
			this.layout(this.dimension);
		}
	}

	openEditor(editor: IEditorInput): void {
		this.getCorrectEditorControl(editor).openEditor(editor);

		// Update Breadcrumbs
		this.updateBreadcrumbsControl();
	}
	closeEditor(editor: IEditorInput): void {
		this.getCorrectEditorControl(editor).openEditor(editor);

		// Update Breadcrumbs
		this.updateBreadcrumbsControl();
	}
	closeEditors(editors: IEditorInput[]): void {
		editors.forEach(editor => {
			this.closeEditor(editor);
		});

		// Update Breadcrumbs
		this.updateBreadcrumbsControl();
	}
	closeAllEditors(): void {
		this.tabsEditorControl.closeAllEditors();
		this.hardPinnedTabsEditorControl.closeAllEditors();

		// Update Breadcrumbs
		this.updateBreadcrumbsControl();
	}
	moveEditor(editor: IEditorInput, fromIndex: number, targetIndex: number): void {
		this.getCorrectEditorControl(editor).moveEditor(editor, fromIndex, targetIndex);
	}
	pinEditor(editor: IEditorInput): void {
		this.getCorrectEditorControl(editor).pinEditor(editor);
	}
	hardPinEditor(editor: IEditorInput): void {
		this.getCorrectEditorControl(editor).hardPinEditor(editor);
	}
	setActive(isActive: boolean): void {
		this.tabsEditorControl.setActive(isActive);
		this.hardPinnedTabsEditorControl.setActive(isActive);

		// Activity has an impact on the toolbar, so we need to update and layout
		this.updateEditorActionsToolbar();
	}
	updateEditorLabel(editor: IEditorInput): void {
		this.getCorrectEditorControl(editor).updateEditorLabel(editor);

		// A change to a label requires a layout to keep the active editor visible
		this.layout(this.dimension);
	}
	updateEditorLabels(): void {
		this.tabsEditorControl.updateEditorLabels();
		this.hardPinnedTabsEditorControl.updateEditorLabels();
	}
	updateEditorDirty(editor: IEditorInput): void {
		this.getCorrectEditorControl(editor).updateEditorDirty(editor);
	}
	updateOptions(oldOptions: IEditorPartOptions, newOptions: IEditorPartOptions): void {
		this.tabsEditorControl.updateOptions(oldOptions, newOptions);
		this.hardPinnedTabsEditorControl.updateOptions(oldOptions, newOptions);
	}
	updateStyles(): void {
		this.tabsEditorControl.updateStyles();
		this.hardPinnedTabsEditorControl.updateStyles();
	}

	private getCorrectEditorControl(editor: IEditorInput): TabsEditorControl {
		if (editor.isHardPinned()) {
			return this.tabsEditorControl;
		}
		return this.hardPinnedTabsEditorControl;
	}


	private updateBreadcrumbsControl(): void {
		if (this.breadcrumbsControl && this.breadcrumbsControl.update()) {
			// relayout when we have a breadcrumbs and when update changed
			// its hidden-status
			this.group.relayout();
		}
	}

	public registerTabsContainerListeners(tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement, tabsEditorControl: TabsEditorControl): void {

		// Group dragging
		this.enableGroupDragging(tabsContainer);

		// Forward scrolling inside the container to our custom scrollbar
		this._register(addDisposableListener(tabsContainer, EventType.SCROLL, () => {
			if (hasClass(tabsContainer, 'scroll')) {
				tabsScrollbar.setScrollPosition({
					scrollLeft: tabsContainer.scrollLeft // during DND the  container gets scrolled so we need to update the custom scrollbar
				});
			}
		}));

		// New file when double clicking on tabs container (but not tabs)
		this._register(addDisposableListener(tabsContainer, EventType.DBLCLICK, e => {
			if (e.target === tabsContainer) {
				EventHelper.stop(e);

				this.group.openEditor(this.untitledEditorService.createOrGet(), { pinned: true /* untitled is always pinned */, index: this.group.count /* always at the end */ });
			}
		}));

		// Prevent auto-scrolling (https://github.com/Microsoft/vscode/issues/16690)
		this._register(addDisposableListener(tabsContainer, EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
			}
		}));

		// Drop support
		this._register(new DragAndDropObserver(tabsContainer, {
			onDragEnter: e => {

				// Always enable support to scroll while dragging
				addClass(tabsContainer, 'scroll');

				// Return if the target is not on the tabs container
				if (e.target !== tabsContainer) {
					tabsEditorControl.updateDropFeedback(tabsContainer, false); // fixes https://github.com/Microsoft/vscode/issues/52093
					return;
				}

				// Return if transfer is unsupported
				if (!tabsEditorControl.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				// Return if dragged editor is last tab because then this is a no-op
				let isLocalDragAndDrop = false;
				if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					isLocalDragAndDrop = true;

					const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
					if (Array.isArray(data)) {
						const localDraggedEditor = data[0].identifier;
						if (this.group.id === localDraggedEditor.groupId && this.group.getIndexOfEditor(localDraggedEditor.editor) === this.group.count - 1) {
							if (e.dataTransfer) {
								e.dataTransfer.dropEffect = 'none';
							}

							return;
						}
					}
				}

				// Update the dropEffect to "copy" if there is no local data to be dragged because
				// in that case we can only copy the data into and not move it from its source
				if (!isLocalDragAndDrop) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				tabsEditorControl.updateDropFeedback(tabsContainer, true);
			},

			onDragLeave: e => {
				tabsEditorControl.updateDropFeedback(tabsContainer, false);
				removeClass(tabsContainer, 'scroll');
			},

			onDragEnd: e => {
				tabsEditorControl.updateDropFeedback(tabsContainer, false);
				removeClass(tabsContainer, 'scroll');
			},

			onDrop: e => {
				tabsEditorControl.updateDropFeedback(tabsContainer, false);
				removeClass(tabsContainer, 'scroll');

				if (e.target === tabsContainer) {
					tabsEditorControl.onDrop(e, this.group.count, tabsContainer);
				}
			}
		}));
	}
}
