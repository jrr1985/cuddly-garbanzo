
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { BasePlatformAccessory } from './basePlatformAccessory';
import { IKHomeBridgeHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class GarageDoorPlatformAccessory extends BasePlatformAccessory {
  private service: Service;
  private intervalId;
  private getStatusTryCount = 0;
  private doorInTransition = false;
  // private  MAX_POLLING_COUNT = 30;  // 30 seconds
  // private platform: IKHomeBridgeHomebridgePlatform;

  // private log: Logger;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */

  constructor(
    platform: IKHomeBridgeHomebridgePlatform,
    accessory: PlatformAccessory,
  ) {

    super(platform, accessory);

    // this.platform = platform;

    // this.log = platform.log;

    this.service = accessory.getService(platform.Service.GarageDoorOpener) || accessory.addService(platform.Service.GarageDoorOpener);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(platform.Characteristic.Name, accessory.context.device.label);
    // this.service.displayName = accessory.context.device.label;

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    this.service.getCharacteristic(platform.Characteristic.TargetDoorState)
      .onSet(this.setDoorState.bind(this));
    this.service.getCharacteristic(platform.Characteristic.CurrentDoorState)
      .onGet(this.getDoorState.bind(this));
    this.service.getCharacteristic(platform.Characteristic.ObstructionDetected)
      .onGet(() => {
        return false;
      });

    // Update states asynchronously

    let pollDoorsSeconds = 10;
    if (this.platform.config.PollDoorsSeconds !== undefined) {
      pollDoorsSeconds = this.platform.config.PollDoorsSeconds;
    }

    if (pollDoorsSeconds > 0) {
      this.log.debug(`Polling lock set to ${pollDoorsSeconds}`);
      setInterval(() => {
        if (!this.doorInTransition) {
          this.platform.log.debug('Updating HomeKit for device ' + accessory.context.device.label);

          this.getDoorState().then((doorState) => {
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentDoorState, doorState);
            switch (doorState) {
              case this.platform.Characteristic.CurrentDoorState.CLOSED: {
                this.service.updateCharacteristic(this.platform.Characteristic.TargetDoorState,
                  this.platform.Characteristic.TargetDoorState.CLOSED);
                break;
              }
              case this.platform.Characteristic.CurrentDoorState.OPEN: {
                this.service.updateCharacteristic(this.platform.Characteristic.TargetDoorState,
                  this.platform.Characteristic.TargetDoorState.OPEN);
                break;
              }
            }
          });
        }
      }, pollDoorsSeconds * 1000);
    }
  }


  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setDoorState(value: CharacteristicValue): Promise<void> {

    this.log.debug('Received setDoorState(' + value + ') event for ' + this.name);

    return new Promise<void>((resolve, reject) => {
      if (!this.online) {
        this.log.error(this.accessory.context.device.label + ' is offline');
        reject(new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
      } else {
        this.doorInTransition = true;
        this.axInstance.post(this.commandURL, JSON.stringify([{
          capability: 'doorControl',
          command: value ? 'close' : 'open',
        }])).then(() => {
          this.log.debug('onDoorState(' + value + ') SUCCESSFUL for ' + this.name);
          this.getStatusTryCount = 0;
          this.intervalId = setInterval(this.poleDoorStatus, 1000, this, value);
          resolve();
        }).catch(reason => {
          this.log.error('setDoorState(' + value + ') FAILED for ' + this.name + ': reason ' + reason);
          reject(new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
          this.doorInTransition = false;
        });
      }
    });
  }

  poleDoorStatus(t, doorCommand): void {

    // Determine the target state
    const targetState = doorCommand ? t.platform.Characteristic.CurrentDoorState.CLOSED :
      t.platform.Characteristic.CurrentDoorState.OPEN;

    // Check to see if we are there yet
    t.axInstance.get(t.statusURL).then(res => {
      const value = res.data.components.main.doorControl.door.value;
      t.log.debug('Polling ' + t.name + ': ' + value);

      // Closed
      if ((value === 'closed') && (targetState === t.platform.Characteristic.CurrentDoorState.CLOSED)) {
        t.service.updateCharacteristic(t.platform.Characteristic.CurrentDoorState,
          t.platform.Characteristic.CurrentDoorState.CLOSED);
        t.doorInTransition = false;
        clearInterval(t.intervalId);

        // Open
      } else if ((value === 'open') && (targetState === t.platform.Characteristic.CurrentDoorState.OPEN)) {
        t.service.updateCharacteristic(t.platform.Characteristic.CurrentDoorState,
          t.platform.Characteristic.CurrentDoorState.OPEN);
        t.doorInTransition = false;
        clearInterval(t.intervalId);
      }
    }).catch(reason => {
      t.log.error('Failed to get door status while polling: ' + reason);
      t.doorInTransition = false;
      clearInterval(t.intervalId);
    });

    // Increment the count of tries.  If exceeded, then quit.
    if (++t.getStatusTryCount > t.platform.config.GarageDoorMaxPoll) {
      t.log.error('Polling door status for ' + t.name + ' max count exceeded');
      t.doorInTransition = false;
      clearInterval(t.intervalId);
    }
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getDoorState(): Promise<CharacteristicValue> {
    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    const states = this.platform.Characteristic.CurrentDoorState;
    return new Promise<CharacteristicValue>((resolve, reject) => {

      if (!this.online) {
        this.log.error(this.accessory.context.device.label + ' is offline');
        return reject(new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
      }

      this.axInstance.get(this.statusURL).then(res => {

        const value = res.data.components.main.doorControl.door.value;
        if (value !== undefined) {
          //  value = null;
          this.log.debug('getDoorState() SUCCESSFUL for ' + this.name + '. value = ' + value);

          // if (value === null) {
          //   return reject('Invalid door state (null)');
          // }

          switch (value) {
            case 'closed': {
              resolve(states.CLOSED);
              break;
            }
            case 'closing': {
              resolve(states.CLOSING);
              break;
            }
            case 'open': {
              resolve(states.OPEN);
              break;
            }
            case 'opening': {
              resolve(states.OPENING);
              break;
            }
            default: {
              this.log.debug(`Invalid door state ${value}.`);
              throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
            }
          }
        } else {
          this.log.error('Got unexpected DOOR STATE: ' + value);
          reject(new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
        }

      }).catch((reason) => {
        this.log.error('getDoorState() FAILED for ' + this.name + '. Comm error ' + reason);
        reject(new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
      });
    });
  }
}