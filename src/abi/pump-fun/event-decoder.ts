import { Buffer } from 'buffer';
import { Src } from '@subsquid/borsh';
import {
  CreateEvent,
  TradeEvent,
  CompleteEvent,
  SetParamsEvent
} from './events';
import { decodeHex } from '../idl.support';

export enum EventType {
  CREATE_EVENT = 'CreateEvent',
  TRADE_EVENT = 'TradeEvent',
  COMPLETE_EVENT = 'CompleteEvent',
  SET_PARAMS_EVENT = 'SetParamsEvent',
  UNKNOWN = 'Unknown'
}

const DISCRIMINATORS = {
  [CreateEvent.d8]: EventType.CREATE_EVENT,
  [TradeEvent.d8]: EventType.TRADE_EVENT,
  [CompleteEvent.d8]: EventType.COMPLETE_EVENT,
  [SetParamsEvent.d8]: EventType.SET_PARAMS_EVENT
};

export class PumpEventDecoder {
  /**
   * Extracts the discriminator from the event data
   * @param base64Data Base64 encoded event data
   * @returns Discriminator as hex string with 0x prefix
   */
  static extractDiscriminator(base64Data: string): string {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      return `0x${buffer.slice(0, 8).toString('hex')}`;
    } catch (error) {
      console.error('Failed to extract discriminator:', error);
      throw new Error('Invalid event data format');
    }
  }

  /**
   * Identifies the event type based on discriminator
   * @param discriminator Event discriminator
   * @returns The identified event type
   */
  static identifyEventType(discriminator: string): EventType {
    return DISCRIMINATORS[discriminator] || EventType.UNKNOWN;
  }

  /**
   * Decodes the event data based on its type
   * @param base64Data Base64 encoded event data
   * @returns Decoded event data
   */
  static decodeEvent(base64Data: string): any {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      const discriminator = `0x${buffer.slice(0, 8).toString('hex')}`;
      const eventType = this.identifyEventType(discriminator);
      
      switch (eventType) {
        case EventType.CREATE_EVENT:
          return {
            type: eventType,
            data: CreateEvent.decodeData(buffer)
          };
        case EventType.TRADE_EVENT:
          return {
            type: eventType,
            data: TradeEvent.decodeData(buffer)
          };
        case EventType.COMPLETE_EVENT:
          return {
            type: eventType,
            data: CompleteEvent.decodeData(buffer)
          };
        case EventType.SET_PARAMS_EVENT:
          return {
            type: eventType,
            data: SetParamsEvent.decodeData(buffer)
          };
        default:
          throw new Error(`Unknown event type for discriminator: ${discriminator}`);
      }
    } catch (error) {
      console.error('Failed to decode event:', error);
      throw error;
    }
  }

  /**
   * Main function to decode and process event data
   * @param base64Data Base64 encoded event data
   * @returns Object with event type and decoded data
   */
  static decode(base64Data: string): { type: EventType; data: any } {
    const discriminator = this.extractDiscriminator(base64Data);
    const eventType = this.identifyEventType(discriminator);
    
    if (eventType === EventType.UNKNOWN) {
      throw new Error(`Unknown event type for discriminator: ${discriminator}`);
    }
    
    return this.decodeEvent(base64Data);
  }
}
