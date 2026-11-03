import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from './user.entity.js';


@Entity('companies')
export class Company{
@PrimaryGeneratedColumn({type:'bigint'})
id:string;

@Column({type:'varchar',length:200,nullable:false})
name:string;

@Column({name:'one_time_capacity',type:'integer',nullable:false,default:1})
oneTimeCapacity:number;

@Column({type:'varchar',length:3,nullable:false,default:'USD'})
currency:string;

@Column({name:'owner_id',type:'bigint',nullable:true})
ownerId:string | null;

@CreateDateColumn({type:'timestamptz',nullable:false,default:()=>'NOW()'})
createdAt:Date;

@ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
@JoinColumn({ name: 'owner_id' })
owner: User | null;
}
