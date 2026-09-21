import * as Phaser from "phaser";
import cashPouchAsset from "../../assets/cash-pouch-blocky-v1.png";
import counterAsset from "../../assets/coffee-counter-blocky-v2.png";
import coffeeCupAsset from "../../assets/coffee-cup-blocky-v1.png";
import baristaAsset from "../../assets/coffee-barista-blocky-v1.png";
import customerAsset from "../../assets/customer-blocky-v1.png";
import managerAsset from "../../assets/manager-cart-blocky-v1.png";
import { counterOrder, counterWorldPositions, drinkConfig } from "../core/config";
import type { GameEvent, GameView } from "../core/types";
import type { GameStore } from "../core/store";
import { sceneLayout } from "./sceneLayout";

interface CustomerMotion {
  key: string;
  index: number;
  targetX: number;
  targetY: number;
  entering: boolean;
  leaving: boolean;
}

function imageSize(width: number, height: number, maxWidth: number, maxHeight: number, aspect = 1) {
  const nextWidth = Math.min(maxWidth, width);
  const nextHeight = Math.min(maxHeight, nextWidth / aspect);
  return { width: nextWidth, height: nextHeight || height };
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class ShopScene extends Phaser.Scene {
  private currentView: GameView | null = null;
  private counterNodes: Record<string, Phaser.GameObjects.Image> = {};
  private baristaNodes: Record<string, Phaser.GameObjects.Image> = {};
  private customerNodes = new Map<string, Phaser.GameObjects.Image>();
  private customerLabels = new Map<string, Phaser.GameObjects.Text>();
  private customerMotions = new Map<string, CustomerMotion>();
  private overflowNodes = new Set<Phaser.GameObjects.Image>();
  private managerNode!: Phaser.GameObjects.Image;
  private managerPouch!: Phaser.GameObjects.Image;
  private managerLabel!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "ShopScene" });
  }

  preload(): void {
    this.load.image("counter", counterAsset);
    this.load.image("barista", baristaAsset);
    this.load.image("customer", customerAsset);
    this.load.image("manager", managerAsset);
    this.load.image("cashPouch", cashPouchAsset);
    this.load.image("coffeeCup", coffeeCupAsset);
  }

  create(): void {
    this.managerNode = this.add.image(0, 0, "manager").setDepth(35);
    this.managerPouch = this.add.image(0, 0, "cashPouch").setDepth(36).setVisible(false);
    this.managerLabel = this.add.text(0, 0, "", {
      fontFamily: "Arial, sans-serif",
      fontSize: "11px",
      color: "#fff7da",
      stroke: "#293f32",
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(37);

    counterOrder.forEach((key) => {
      this.counterNodes[key] = this.add.image(0, 0, "counter").setDepth(8);
      this.baristaNodes[key] = this.add.image(0, 0, "barista").setDepth(16);
    });

    this.scale.on("resize", () => this.draw(this.currentView));
    this.draw(this.currentView);
  }

  update(): void {
    // Rendering only. The core store owns time and all business transitions.
    if (this.currentView) {
      this.draw(this.currentView);
    }
  }

  setView(view: GameView): void {
    this.currentView = view;
    this.draw(view);
  }

  private position(key: string, width: number): number {
    return (counterWorldPositions[key] || counterWorldPositions.counter1) / 100 * width;
  }

  private customerPosition(key: string, index: number, width: number, height: number) {
    const center = counterWorldPositions[key] || counterWorldPositions.counter1;
    const row = Math.floor(Math.max(0, index) / 3);
    const column = Math.max(0, index) % 3;
    const rowSpread = 4.8 + Math.min(row, 3) * 2.1;
    const x = (center + (column - 1) * rowSpread - Math.min(row, 3) * 1.4) / 100 * width;
    const y = height * (sceneLayout.customer.rugTop + 0.08 + Math.min(row, 3) * 0.105 + column * 0.012);
    return { x, y, scale: Math.min(0.9, 0.64 + Math.min(row, 3) * 0.075) };
  }

  private addFloatingText(text: string, x: number, y: number, color = "#fff0b8"): void {
    const node = this.add.text(x, y, text, {
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      fontStyle: "700",
      color,
      stroke: "#293f32",
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({
      targets: node,
      y: y - 32,
      alpha: 0,
      duration: 900,
      ease: "Cubic.easeOut",
      onComplete: () => node.destroy()
    });
  }

  private playCashMove(event: GameEvent): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const fromKey = typeof event.counterKey === "string" ? event.counterKey : "counter1";
    const isDeposit = event.type === "cash-deposited";
    const fromX = isDeposit ? this.position("counter1", width) : this.position(fromKey, width);
    const toX = isDeposit ? this.position("vault", width) : this.position("counter1", width);
    const startY = height * sceneLayout.manager.routeY;
    const endY = height * sceneLayout.manager.routeY;
    const pouch = this.add.image(fromX, startY, "cashPouch").setDepth(48);
    const size = imageSize(34, 34, 34, 34, 1);
    pouch.setDisplaySize(size.width, size.height);
    this.tweens.add({
      targets: pouch,
      x: toX,
      y: endY,
      duration: 520,
      ease: "Sine.easeInOut",
      onComplete: () => {
        pouch.destroy();
        this.addFloatingText(`+ ¥ ${Math.floor(numberValue(event.amount))}`, toX, endY - 8, isDeposit ? "#e6ffc2" : "#fff0b8");
      }
    });
  }

  private playCupHandoff(event: GameEvent): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const counterKey = typeof event.counterKey === "string" ? event.counterKey : "counter1";
    const source = { x: this.position(counterKey, width), y: height * sceneLayout.counter.centerY };
    const customer = event.customer as { id?: unknown } | undefined;
    const customerNode = typeof customer?.id === "string" ? this.customerNodes.get(customer.id) : undefined;
    const fallbackTarget = this.customerPosition(counterKey, 0, width, height);
    const target = customerNode ? { x: customerNode.x, y: customerNode.y, scale: fallbackTarget.scale } : fallbackTarget;
    const cup = this.add.image(source.x, source.y, "coffeeCup").setDepth(49);
    cup.setDisplaySize(20, 22);
    const settledScaleX = cup.scaleX;
    const settledScaleY = cup.scaleY;
    cup.setScale(settledScaleX * 0.72, settledScaleY * 0.72);
    this.addFloatingText("取杯", target.x, target.y - 42, "#fff0b8");
    this.tweens.add({
      targets: cup,
      x: target.x,
      y: target.y - 18,
      scaleX: settledScaleX,
      scaleY: settledScaleY,
      duration: 450,
      ease: "Cubic.easeOut",
      onComplete: () => {
        cup.destroy();
        this.addFloatingText(`+ ¥ ${Math.floor(numberValue(event.amount))}`, source.x, source.y - 10, "#fff0b8");
      }
    });
  }

  private playCustomerDeparture(event: GameEvent): void {
    const customer = event.customer as { id?: unknown } | undefined;
    const id = typeof customer?.id === "string" ? customer.id : "";
    const node = id ? this.customerNodes.get(id) : undefined;
    if (!id || !node) {
      return;
    }
    const label = this.customerLabels.get(id);
    const motion = this.customerMotions.get(id);
    const width = this.scale.width;
    const height = this.scale.height;
    const exitX = width * sceneLayout.customer.exitX;
    const exitY = height * sceneLayout.customer.exitY;
    this.tweens.killTweensOf(node);
    if (label) {
      this.tweens.killTweensOf(label);
      label.setText("取杯中");
    }
    this.customerMotions.set(id, {
      key: motion?.key || String(event.counterKey || "counter1"),
      index: motion?.index || 0,
      targetX: exitX,
      targetY: exitY,
      entering: false,
      leaving: true
    });
    this.tweens.add({
      targets: node,
      x: exitX,
      y: exitY,
      alpha: 0,
      delay: 260,
      duration: 940,
      ease: "Cubic.easeIn",
      onComplete: () => {
        node.destroy();
        label?.destroy();
        this.customerNodes.delete(id);
        this.customerLabels.delete(id);
        this.customerMotions.delete(id);
      }
    });
    if (label) {
      this.tweens.add({
        targets: label,
        x: exitX,
        y: exitY - 40,
        alpha: 0,
        delay: 260,
        duration: 940,
        ease: "Cubic.easeIn"
      });
    }
  }

  private playCustomerOverflow(event: GameEvent): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const startX = width * sceneLayout.customer.entryX;
    const startY = height * sceneLayout.customer.entryY;
    const exitX = width * sceneLayout.customer.exitX;
    const exitY = height * sceneLayout.customer.exitY;
    const node = this.add.image(startX, startY, "customer").setDepth(32);
    node.setDisplaySize(Math.min(50, width * 0.06), Math.min(76, height * 0.2));
    const label = this.add.text(startX, startY - 44, "满位 · 离店", {
      fontFamily: "Arial, sans-serif",
      fontSize: "11px",
      color: "#fff6cf",
      backgroundColor: "#355a4d",
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
      stroke: "#394b40",
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(48);
    this.overflowNodes.add(node);
    this.tweens.add({
      targets: node,
      x: exitX,
      y: exitY,
      alpha: 0,
      duration: 1250,
      ease: "Cubic.easeInOut",
      onComplete: () => {
        node.destroy();
        label.destroy();
        this.overflowNodes.delete(node);
      }
    });
    this.tweens.add({
      targets: label,
      x: exitX,
      y: exitY - 40,
      alpha: 0,
      duration: 1250,
      ease: "Cubic.easeInOut"
    });
  }

  private playRushFeedback(event: GameEvent): void {
    const counterKey = typeof event.counterKey === "string" ? event.counterKey : "counter1";
    this.addFloatingText("⚡ 加急出杯", this.position(counterKey, this.scale.width), this.scale.height * (sceneLayout.counter.centerY - 0.1), "#fff0a8");
  }

  draw(view: GameView | null): void {
    if (!view || !this.scale || !this.managerNode) {
      return;
    }
    const width = this.scale.width;
    const height = this.scale.height;
    counterOrder.forEach((key) => {
      const counter = view.counters[key];
      const counterSprite = this.counterNodes[key];
      const barista = this.baristaNodes[key];
      const x = this.position(key, width);
      const counterSize = imageSize(width * sceneLayout.counter.width, 96, width * sceneLayout.counter.width, height * 0.3, 2.33);
      // The location backdrop already contains the physical coffee machines
      // and cabinetry. Keep the Phaser node available for compatibility, but
      // do not paint a second flat counter over the authored rear scene.
      counterSprite.setPosition(x, height * sceneLayout.counter.centerY).setDisplaySize(counterSize.width, counterSize.height).setVisible(false).setDepth(20);
      counterSprite.setAlpha(counter.unlocked ? 0.96 : 0.28);
      barista.setPosition(x, height * sceneLayout.barista.centerY).setDisplaySize(Math.min(72, width * 0.1), Math.min(96, height * 0.25)).setDepth(12);
      barista.setVisible(Boolean(counter.unlocked && counter.baristas > 0));
      barista.setAlpha(view.isOpen ? 1 : 0.48);
      const tint = counter.unlocked ? 0xffffff : 0x8b9081;
      counterSprite.setTint(tint);
      barista.setTint(tint);
    });

    const activeIds = new Set<string>();
    counterOrder.forEach((key) => {
      const counter = view.counters[key];
      if (!counter.unlocked) {
        return;
      }
      counter.queue.forEach((customer, index) => {
        activeIds.add(customer.id);
        let node = this.customerNodes.get(customer.id);
        const target = this.customerPosition(key, index, width, height);
        if (!node) {
          node = this.add.image(width * sceneLayout.customer.entryX, height * sceneLayout.customer.entryY, "customer").setDepth(25 + Math.round(target.y));
          this.customerNodes.set(customer.id, node);
          this.customerMotions.set(customer.id, {
            key,
            index,
            targetX: target.x,
            targetY: target.y,
            entering: true,
            leaving: false
          });
          this.tweens.add({
            targets: node,
            x: target.x,
            y: target.y,
            alpha: view.isOpen ? 1 : 0.42,
            delay: Math.min(index, 5) * 85,
            duration: 760 + Math.min(index, 5) * 45,
            ease: "Cubic.easeOut",
            onComplete: () => {
              const motion = this.customerMotions.get(customer.id);
              if (motion) {
                motion.entering = false;
              }
            }
          });
        } else {
          const previous = this.customerMotions.get(customer.id);
          const targetChanged = !previous || previous.key !== key || previous.index !== index || Math.abs(previous.targetX - target.x) > 1 || Math.abs(previous.targetY - target.y) > 1;
          if (previous?.leaving) {
            this.tweens.killTweensOf(node);
            this.customerMotions.set(customer.id, { key, index, targetX: target.x, targetY: target.y, entering: false, leaving: false });
          } else if (targetChanged) {
            this.tweens.killTweensOf(node);
            this.customerMotions.set(customer.id, {
              key,
              index,
              targetX: target.x,
              targetY: target.y,
              entering: previous?.entering || false,
              leaving: false
            });
            this.tweens.add({
              targets: node,
              x: target.x,
              y: target.y,
              duration: previous?.entering ? 650 : 420,
              ease: "Cubic.easeInOut",
              onComplete: () => {
                const motion = this.customerMotions.get(customer.id);
                if (motion) {
                  motion.entering = false;
                }
              }
            });
          }
        }
        const motion = this.customerMotions.get(customer.id);
        node.setDisplaySize(Math.min(52, width * 0.067) * target.scale, Math.min(78, height * 0.23) * target.scale);
        node.setDepth(25 + Math.round(target.y));
        node.setTint(index === 0 ? 0xffffff : 0xf1ead7);
        let label = this.customerLabels.get(customer.id);
        if (!label) {
          label = this.add.text(0, 0, "", {
            fontFamily: "Arial, sans-serif",
            fontSize: "11px",
            color: "#fff9e9",
            backgroundColor: "#355a4d",
            padding: { left: 4, right: 4, top: 2, bottom: 2 },
            stroke: "#394b40",
            strokeThickness: 3
          }).setOrigin(0.5).setDepth(40);
          this.customerLabels.set(customer.id, label);
        }
        const statusText = customer.status === "serving"
          ? `${drinkConfig[counter.drink].shortName} · 制作中`
          : customer.status === "ready"
            ? "取杯中"
            : index === 0 ? "等候中" : "排队中";
        label.setPosition(node.x, node.y - node.displayHeight / 2 - 8).setText(statusText);
        if (!motion?.entering && !motion?.leaving) {
          node.setAlpha(view.isOpen ? 1 : 0.42);
          label.setAlpha(view.isOpen ? 1 : 0.45);
        }
      });
    });

    this.customerNodes.forEach((node, id) => {
      if (!activeIds.has(id)) {
        if (this.customerMotions.get(id)?.leaving) {
          return;
        }
        node.destroy();
        this.customerNodes.delete(id);
        const label = this.customerLabels.get(id);
        label?.destroy();
        this.customerLabels.delete(id);
        this.customerMotions.delete(id);
      }
    });

    const motion = view.managerMotion;
    const managerX = motion.position / 100 * width;
    this.managerNode.setPosition(managerX, height * sceneLayout.manager.routeY).setDisplaySize(Math.min(80, width * 0.1), Math.min(86, height * 0.24)).setDepth(10);
    this.managerNode.setAlpha(view.isOpen ? 1 : 0.42);
    this.managerPouch.setPosition(managerX + 20, height * (sceneLayout.manager.routeY - 0.01)).setDisplaySize(23, 23).setDepth(13).setVisible(view.manager.carrying > 0);
    this.managerLabel.setPosition(managerX, height * (sceneLayout.manager.routeY - 0.1)).setText(view.manager.carrying > 0 ? `推车 ¥ ${Math.floor(view.manager.carrying)}` : "经理");
    this.managerLabel.setAlpha(view.isOpen ? 1 : 0.45);
  }

  handleEvent(event: GameEvent): void {
    if (!this.managerNode) {
      return;
    }
    if (event.type === "counter-rushed") {
      this.playRushFeedback(event);
    }
    if (event.type === "cup-delivered") {
      this.playCupHandoff(event);
      this.playCustomerDeparture(event);
    }
    if (event.type === "customer-overflow") {
      this.playCustomerOverflow(event);
    }
    if (event.type === "cash-collected" || event.type === "cash-deposited") {
      this.playCashMove(event);
    }
  }
}

export interface MountedShopScene {
  available: boolean;
  syncView(view: GameView): void;
  handleEvent(event: GameEvent): void;
  destroy(): void;
}

export function mountShopScene({ engine: _engine }: { engine: GameStore }): MountedShopScene {
  const container = document.getElementById("phaserSceneLayer");
  const shopScene = document.getElementById("shopScene");
  if (!container || !shopScene) {
    return { available: false, syncView() {}, handleEvent() {}, destroy() {} };
  }

  shopScene.classList.add("phaser-enabled");
  const scene = new ShopScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    transparent: true,
    width: container.clientWidth || 800,
    height: container.clientHeight || 420,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: { antialias: false, pixelArt: true, roundPixels: true },
    scene
  });

  return {
    available: true,
    syncView(view: GameView) {
      scene.setView(view);
    },
    handleEvent(event: GameEvent) {
      scene.handleEvent(event);
    },
    destroy() {
      game.destroy(true);
    }
  };
}
